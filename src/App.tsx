/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderGit2, Menu, Plus, Terminal, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import type {
  AcceleratorType,
  BridgeInfo,
  ColabStatePayload,
  EnvVarEntry,
  GitHubFetchedNotebook,
  LogEntry,
  NavSection,
  NotebookItem,
  NotebookRunState,
  RuntimeSession,
  TelemetryPoint,
} from './types';
import { googleSignIn, initAuth, logout } from './lib/auth';
import {
  deleteDriveNotebook,
  downloadDriveNotebookCells,
  DriveSessionExpiredError,
  findExistingDriveNotebook,
  listDriveNotebooks,
  saveNotebookToDrive,
} from './lib/drive';
import {
  clearServerLogs,
  createRuntime,
  disconnectColabCliAuth,
  fetchColabState,
  probeColabBridge,
  startNotebookExecution,
  stopNotebookExecution,
  stopRuntime,
  syncColabSessions,
} from './lib/colabApi';
import { Sidebar } from './components/Sidebar';
import { GitHubImportModal } from './components/GitHubImportModal';
import { NewRuntimeModal } from './components/NewRuntimeModal';
import { NotebookEnvModal } from './components/NotebookEnvModal';
import { ColabCliAuthModal } from './components/ColabCliAuthModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DashboardView } from './views/DashboardView';
import { NotebooksView } from './views/NotebooksView';
import { RuntimesView } from './views/RuntimesView';
import { LogsView } from './views/LogsView';

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  notebooks: 'Notebooks',
  runtimes: 'Runtimes',
  logs: 'Logs',
};

interface PendingConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  variant: 'danger' | 'warning';
  action: () => Promise<void>;
}

interface ToastMessage {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Google Auth & Drive Notebooks state
  const [user, setUser] = useState<User | null>(null);
  const [driveConnected, setDriveConnected] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [driveNotebooks, setDriveNotebooks] = useState<NotebookItem[]>([]);
  const [githubNotebooks, setGithubNotebooks] = useState<NotebookItem[]>([]);
  const [notebookEnvs, setNotebookEnvs] = useState<Record<string, EnvVarEntry[]>>({});
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);

  // Colab CLI Bridge & Runtime telemetry state
  const [bridge, setBridge] = useState<BridgeInfo>({
    mode: 'cli_missing',
    cliInstalled: false,
    cliVersion: null,
    authAccount: null,
    lastCommand: null,
    checkedAt: new Date().toISOString(),
  });
  const [runtimes, setRuntimes] = useState<RuntimeSession[]>([]);
  const [activeRuntimeId, setActiveRuntimeId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, NotebookRunState>>({});
  const [telemetryHistory, setTelemetryHistory] = useState<Record<string, TelemetryPoint[]>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Modals & Toasts
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [runtimeModalOpen, setRuntimeModalOpen] = useState(false);
  const [cliAuthModalOpen, setCliAuthModalOpen] = useState(false);
  const [envModalNotebook, setEnvModalNotebook] = useState<NotebookItem | null>(null);
  const [startingNotebookId, setStartingNotebookId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now();
    setToast({ id, text, kind });
    setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 3600);
  }, []);

  const loadDriveFiles = useCallback(async () => {
    setLoadingDrive(true);
    setDriveError(null);
    try {
      const files = await listDriveNotebooks();
      setDriveNotebooks(files);
      setDriveConnected(true);
    } catch (err) {
      if (err instanceof DriveSessionExpiredError) {
        setDriveConnected(false);
        setDriveError(null);
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to load Google Drive notebooks.';
        setDriveError(msg);
      }
    } finally {
      setLoadingDrive(false);
    }
  }, []);

  useEffect(() => {
    const unsub = initAuth(
      (authedUser, hasDriveSession) => {
        setUser(authedUser);
        setDriveConnected(hasDriveSession);
        if (hasDriveSession) {
          loadDriveFiles();
        }
      },
      () => {
        setUser(null);
        setDriveConnected(false);
        setDriveNotebooks([]);
      }
    );
    return () => unsub();
  }, [loadDriveFiles]);

  const applyColabState = useCallback((state: ColabStatePayload) => {
    setBridge(state.bridge);
    setRuntimes(state.runtimes);
    setRuns(state.runs);
    setTelemetryHistory(state.telemetryHistory);
    setLogs(state.logs);
    setActiveRuntimeId((prev) => {
      if (prev && state.runtimes.some((r) => r.id === prev && r.status !== 'stopped')) {
        return prev;
      }
      const firstActive = state.runtimes.find((r) => r.status !== 'stopped');
      return firstActive?.id ?? null;
    });
  }, []);

  useEffect(() => {
    let closed = false;

    fetchColabState()
      .then((state) => {
        if (!closed) applyColabState(state);
      })
      .catch(() => {
        // SSE will retry
      });

    const source = new EventSource('/api/colab/stream');

    source.addEventListener('init', (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as ColabStatePayload;
        applyColabState(payload);
      } catch {
        // ignore
      }
    });

    source.addEventListener('bridge', (ev) => {
      try {
        const info = JSON.parse((ev as MessageEvent).data) as BridgeInfo;
        setBridge(info);
      } catch {
        // ignore
      }
    });

    source.addEventListener('runtime', (ev) => {
      try {
        const updated = JSON.parse((ev as MessageEvent).data) as RuntimeSession;
        setRuntimes((prev) => {
          const exists = prev.some((r) => r.id === updated.id);
          return exists
            ? prev.map((r) => (r.id === updated.id ? updated : r))
            : [updated, ...prev];
        });
        setActiveRuntimeId((prev) => {
          if (prev && prev !== updated.id) return prev;
          if (updated.status !== 'stopped') return updated.id;
          return null;
        });
      } catch {
        // ignore
      }
    });

    source.addEventListener('telemetry', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          runtimeId: string;
          point: TelemetryPoint;
        };
        setRuntimes((prev) =>
          prev.map((r) =>
            r.id === data.runtimeId ? { ...r, latestTelemetry: data.point } : r
          )
        );
        setTelemetryHistory((prev) => {
          const list = [...(prev[data.runtimeId] ?? []), data.point];
          if (list.length > 60) list.splice(0, list.length - 60);
          return { ...prev, [data.runtimeId]: list };
        });
      } catch {
        // ignore
      }
    });

    source.addEventListener('run', (ev) => {
      try {
        const run = JSON.parse((ev as MessageEvent).data) as NotebookRunState;
        setRuns((prev) => ({ ...prev, [run.notebookId]: run }));
      } catch {
        // ignore
      }
    });

    source.addEventListener('log', (ev) => {
      try {
        const entry = JSON.parse((ev as MessageEvent).data) as LogEntry;
        setLogs((prev) => {
          if (prev.some((l) => l.id === entry.id)) return prev;
          const next = [...prev, entry];
          return next.length > 400 ? next.slice(next.length - 400) : next;
        });
      } catch {
        // ignore
      }
    });

    source.addEventListener('logs_cleared', () => {
      setLogs([]);
    });

    return () => {
      closed = true;
      source.close();
    };
  }, [applyColabState]);

  const handleSignIn = async () => {
    setIsLoggingIn(true);
    setDriveError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setDriveConnected(true);
        showToast(`Signed in as ${result.user.email || result.user.displayName}`);
        await loadDriveFiles();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      showToast(msg, 'error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await logout();
      setUser(null);
      setDriveConnected(false);
      setDriveNotebooks([]);
      setDriveError(null);
      showToast('Signed out of Google account');
    } catch {
      showToast('Sign-out failed', 'error');
    }
  };

  const notebooks: NotebookItem[] = useMemo(
    () => [...githubNotebooks, ...driveNotebooks],
    [githubNotebooks, driveNotebooks]
  );

  const activeRuntime = useMemo(() => {
    const matched = runtimes.find((r) => r.id === activeRuntimeId && r.status !== 'stopped');
    if (matched) return matched;
    return runtimes.find((r) => r.status !== 'stopped') ?? null;
  }, [runtimes, activeRuntimeId]);

  const runningCount = useMemo(
    () => Object.values(runs).filter((r) => r.status === 'running').length,
    [runs]
  );

  const handleSaveNotebookEnv = (notebookId: string, entries: EnvVarEntry[]) => {
    setNotebookEnvs((prev) => {
      const next = { ...prev };
      if (entries.length === 0) {
        delete next[notebookId];
      } else {
        next[notebookId] = entries;
      }
      return next;
    });
    showToast(
      entries.length > 0
        ? `Saved ${entries.length} environment variable(s)`
        : 'Cleared notebook environment variables'
    );
  };

  const handleCreateRuntime = async (name: string, accelerator: AcceleratorType) => {
    const created = await createRuntime(name, accelerator);
    setActiveRuntimeId(created.id);
    showToast(`Provisioned runtime "${created.name}" (${created.specs.label})`);
  };

  const handleRequestStopRuntime = (rt: RuntimeSession) => {
    setConfirmState({
      title: `Stop runtime "${rt.name}"?`,
      description: rt.activeNotebookName
        ? `This terminates "${rt.name}" (${rt.specs.label}) and stops running "${rt.activeNotebookName}".`
        : `This terminates "${rt.name}" (${rt.specs.label}) and releases its compute resources.`,
      confirmLabel: 'Stop Runtime',
      variant: 'danger',
      action: async () => {
        await stopRuntime(rt.id);
        showToast(`Stopped runtime "${rt.name}"`);
      },
    });
  };

  const handleStartNotebook = async (nb: NotebookItem, explicitRuntimeId?: string) => {
    if (bridge.mode === 'cli_unauthenticated') {
      setCliAuthModalOpen(true);
      return;
    }
    if (bridge.mode !== 'cli') {
      showToast('google-colab-cli is not installed on this server.', 'error');
      return;
    }

    const targetRuntimeId = explicitRuntimeId ?? activeRuntime?.id ?? 'auto:CPU';
    setStartingNotebookId(nb.id);

    try {
      let cells = nb.codeCells;
      if (nb.source === 'drive' && !cells) {
        if (!driveConnected) {
          showToast('Reconnect Google Drive to read notebook contents.', 'error');
          return;
        }
        try {
          const downloaded = await downloadDriveNotebookCells(nb.id);
          cells = downloaded.codeCells;
        } catch (err) {
          if (err instanceof DriveSessionExpiredError) {
            setDriveConnected(false);
          }
          const msg = err instanceof Error ? err.message : 'Failed to download notebook from Drive.';
          showToast(msg, 'error');
          return;
        }
      }

      if (!cells || cells.length === 0) {
        showToast('Notebook has no executable code cells.', 'error');
        return;
      }

      const envEntries = notebookEnvs[nb.id] ?? [];
      const envMap: Record<string, string> = {};
      for (const entry of envEntries) {
        if (entry.key.trim()) {
          envMap[entry.key.trim()] = entry.value;
        }
      }

      if (targetRuntimeId.startsWith('auto:')) {
        showToast(`Provisioning Colab runtime for ${nb.name}...`);
      }

      const result = await startNotebookExecution({
        notebookId: nb.id,
        notebookName: nb.name,
        runtimeId: targetRuntimeId,
        cells,
        env: envMap,
      });
      if (result.runtime?.id) {
        setActiveRuntimeId(result.runtime.id);
      }
      showToast(`Started ${nb.name} on ${result.runtime?.name ?? 'Colab'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start notebook.';
      showToast(msg, 'error');
    } finally {
      setStartingNotebookId((prev) => (prev === nb.id ? null : prev));
    }
  };

  const handleStopNotebook = async (notebookId: string) => {
    try {
      await stopNotebookExecution(notebookId);
      showToast('Notebook execution stopped');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to stop notebook.';
      showToast(msg, 'error');
    }
  };

  const handleGitHubImportComplete = async (fetched: GitHubFetchedNotebook) => {
    if (user && driveConnected) {
      try {
        const existing = await findExistingDriveNotebook(fetched.fileName);
        if (existing) {
          setConfirmState({
            title: `Overwrite "${fetched.fileName}" in Google Drive?`,
            description: `A file named "${fetched.fileName}" already exists in your Google Drive. Confirm to replace its contents with the GitHub notebook.`,
            confirmLabel: 'Overwrite File',
            variant: 'warning',
            action: async () => {
              const saved = await saveNotebookToDrive(
                fetched.fileName,
                fetched.rawJson,
                existing.id
              );
              setDriveNotebooks((prev) => [
                { ...saved, cellCount: fetched.cellCount, codeCells: fetched.codeCells },
                ...prev.filter((f) => f.id !== saved.id),
              ]);
              showToast(`Updated "${saved.name}" in Google Drive`);
            },
          });
          return;
        }

        const saved = await saveNotebookToDrive(fetched.fileName, fetched.rawJson);
        setDriveNotebooks((prev) => [
          { ...saved, cellCount: fetched.cellCount, codeCells: fetched.codeCells },
          ...prev,
        ]);
        showToast(`Saved "${saved.name}" to Google Drive / Colab Notebooks`);
        return;
      } catch (err) {
        if (err instanceof DriveSessionExpiredError) {
          setDriveConnected(false);
        }
        throw err;
      }
    }

    const importedNb: NotebookItem = {
      id: `gh-${Date.now()}`,
      name: fetched.fileName,
      source: 'github',
      modifiedTime: new Date().toISOString(),
      sizeBytes: fetched.sizeBytes,
      webViewLink: `https://colab.research.google.com/github/${fetched.blobUrl.replace(/^https:\/\/github\.com\//, '')}`,
      cellCount: fetched.cellCount,
      githubUrl: fetched.blobUrl,
      codeCells: fetched.codeCells,
    };
    setGithubNotebooks((prev) => [importedNb, ...prev]);
    showToast(`Imported "${importedNb.name}" (${fetched.cellCount} cells)`);
  };

  const handleRequestDeleteNotebook = (nb: NotebookItem) => {
    const isDrive = nb.source === 'drive';
    setConfirmState({
      title: isDrive ? `Delete "${nb.name}" from Google Drive?` : `Remove "${nb.name}"?`,
      description: isDrive
        ? `This permanently deletes "${nb.name}" from your Google Drive. This action cannot be undone.`
        : `Remove "${nb.name}" from your workspace list?`,
      confirmLabel: isDrive ? 'Delete from Drive' : 'Remove',
      variant: 'danger',
      action: async () => {
        if (runs[nb.id]?.status === 'running') {
          await stopNotebookExecution(nb.id);
        }
        if (isDrive) {
          try {
            await deleteDriveNotebook(nb.id);
          } catch (err) {
            if (err instanceof DriveSessionExpiredError) {
              setDriveConnected(false);
            }
            throw err;
          }
          setDriveNotebooks((prev) => prev.filter((item) => item.id !== nb.id));
          showToast(`Deleted "${nb.name}" from Google Drive`);
        } else {
          setGithubNotebooks((prev) => prev.filter((item) => item.id !== nb.id));
          showToast(`Removed "${nb.name}"`);
        }
      },
    });
  };

  const executeConfirm = async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    try {
      await confirmState.action();
      setConfirmState(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed.';
      showToast(msg, 'error');
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleClearLogs = async () => {
    try {
      await clearServerLogs();
      setLogs([]);
    } catch {
      showToast('Failed to clear logs', 'error');
    }
  };

  const handleProbeBridge = async () => {
    const info = await probeColabBridge();
    setBridge(info);
    showToast(
      info.mode === 'cli'
        ? `Connected to google-colab-cli (${info.cliVersion})`
        : info.mode === 'cli_unauthenticated'
          ? `google-colab-cli ${info.cliVersion ?? ''} ready — click Connect Colab CLI`
          : info.mode === 'cli_installing'
            ? 'Installing google-colab-cli on server...'
            : 'google-colab-cli not installed on host'
    );
  };

  const handleCliConnected = async (nextBridge: BridgeInfo) => {
    setBridge(nextBridge);
    try {
      const state = await fetchColabState();
      applyColabState(state);
    } catch {
      // SSE updates state as well
    }
    showToast(
      nextBridge.authAccount
        ? `Connected Colab CLI as ${nextBridge.authAccount}`
        : 'Connected Colab CLI'
    );
  };

  const handleDisconnectCli = async () => {
    try {
      const res = await disconnectColabCliAuth();
      setBridge(res.bridge);
      showToast('Disconnected Colab CLI');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to disconnect Colab CLI.';
      showToast(msg, 'error');
    }
  };

  const handleSyncSessions = async () => {
    try {
      const res = await syncColabSessions();
      setRuntimes(res.runtimes);
      showToast(`Synced ${res.runtimes.length} Colab session(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to sync sessions.';
      showToast(msg, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-200">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        activeRuntime={activeRuntime}
        runningCount={runningCount}
        user={user}
        isLoggingIn={isLoggingIn}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
      />

      {/* Main Content Wrapper */}
      <div className="flex min-h-screen flex-col lg:pl-60">
        {/* Minimal Top Header — NO navigation tabs */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-800 bg-[#0B1120]/95 px-5 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-base font-semibold text-slate-100 whitespace-nowrap">
              {SECTION_TITLES[activeSection]}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {(activeSection === 'dashboard' || activeSection === 'notebooks') && (
              <button
                type="button"
                onClick={() => setGithubModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:text-white whitespace-nowrap shrink-0"
              >
                <FolderGit2 className="h-3.5 w-3.5" />
                <span>Import GitHub</span>
              </button>
            )}
            {(activeSection === 'dashboard' || activeSection === 'runtimes') &&
              (bridge.mode === 'cli_unauthenticated' ? (
                <button
                  type="button"
                  onClick={() => setCliAuthModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap shrink-0"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  <span>Connect Colab CLI</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setRuntimeModalOpen(true)}
                  disabled={bridge.mode !== 'cli'}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>New Runtime</span>
                </button>
              ))}
          </div>
        </header>

        {/* Active Section Viewport */}
        <main className="flex-1 p-5">
          {activeSection === 'dashboard' && (
            <DashboardView
              bridgeMode={bridge.mode}
              activeRuntime={activeRuntime}
              runtimes={runtimes}
              onSelectRuntime={setActiveRuntimeId}
              telemetryPoints={activeRuntime ? telemetryHistory[activeRuntime.id] ?? [] : []}
              notebooks={notebooks}
              notebookEnvs={notebookEnvs}
              runs={runs}
              startingNotebookId={startingNotebookId}
              logs={logs}
              onStartNotebook={(nb) => handleStartNotebook(nb)}
              onStopNotebook={handleStopNotebook}
              onOpenNotebookEnv={setEnvModalNotebook}
              onNavigate={setActiveSection}
              onOpenNewRuntime={() => setRuntimeModalOpen(true)}
              onOpenCliAuth={() => setCliAuthModalOpen(true)}
            />
          )}

          {activeSection === 'notebooks' && (
            <NotebooksView
              bridgeMode={bridge.mode}
              notebooks={notebooks}
              notebookEnvs={notebookEnvs}
              loading={loadingDrive}
              startingNotebookId={startingNotebookId}
              driveError={driveError}
              isSignedIn={Boolean(user)}
              driveConnected={driveConnected}
              isLoggingIn={isLoggingIn}
              runtimes={runtimes}
              activeRuntimeId={activeRuntime?.id ?? null}
              runs={runs}
              onSignIn={handleSignIn}
              onRefreshDrive={() => loadDriveFiles()}
              onOpenGitHubImport={() => setGithubModalOpen(true)}
              onOpenCliAuth={() => setCliAuthModalOpen(true)}
              onOpenNotebookEnv={setEnvModalNotebook}
              onStartNotebook={(nb, rtId) => handleStartNotebook(nb, rtId)}
              onStopNotebook={handleStopNotebook}
              onRequestDeleteNotebook={handleRequestDeleteNotebook}
            />
          )}

          {activeSection === 'runtimes' && (
            <RuntimesView
              bridge={bridge}
              runtimes={runtimes}
              activeRuntimeId={activeRuntime?.id ?? null}
              onSelectRuntime={setActiveRuntimeId}
              onOpenNewRuntime={() => setRuntimeModalOpen(true)}
              onOpenCliAuth={() => setCliAuthModalOpen(true)}
              onDisconnectCli={handleDisconnectCli}
              onRequestStopRuntime={handleRequestStopRuntime}
              onProbeBridge={handleProbeBridge}
              onSyncSessions={handleSyncSessions}
            />
          )}

          {activeSection === 'logs' && (
            <LogsView logs={logs} onClearLogs={handleClearLogs} />
          )}
        </main>
      </div>

      {/* Modals */}
      <GitHubImportModal
        open={githubModalOpen}
        isSignedIn={Boolean(user && driveConnected)}
        onClose={() => setGithubModalOpen(false)}
        onImportComplete={handleGitHubImportComplete}
      />

      <NewRuntimeModal
        open={runtimeModalOpen}
        onClose={() => setRuntimeModalOpen(false)}
        onCreate={handleCreateRuntime}
      />

      <ColabCliAuthModal
        open={cliAuthModalOpen}
        onClose={() => setCliAuthModalOpen(false)}
        onConnected={handleCliConnected}
      />

      <NotebookEnvModal
        notebook={envModalNotebook}
        initialEntries={envModalNotebook ? notebookEnvs[envModalNotebook.id] ?? [] : []}
        onClose={() => setEnvModalNotebook(null)}
        onSave={handleSaveNotebookEnv}
      />

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title ?? ''}
        description={confirmState?.description ?? ''}
        confirmLabel={confirmState?.confirmLabel ?? 'Confirm'}
        variant={confirmState?.variant ?? 'danger'}
        busy={confirmBusy}
        onConfirm={executeConfirm}
        onCancel={() => !confirmBusy && setConfirmState(null)}
      />

      {/* Unobtrusive Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-md border border-slate-700 bg-[#111827] px-4 py-2.5 text-xs text-slate-100">
          <span className={toast.kind === 'error' ? 'text-red-400' : 'text-slate-200'}>
            {toast.text}
          </span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-500 hover:text-slate-200"
            aria-label="Dismiss notification"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
