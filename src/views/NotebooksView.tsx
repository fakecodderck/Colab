import { useMemo, useState } from 'react';
import {
  ExternalLink,
  FolderGit2,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import type {
  BridgeInfo,
  EnvVarEntry,
  NotebookItem,
  NotebookRunState,
  RuntimeSession,
} from '../types';
import { formatBytes, formatRelativeTime } from '../lib/colabApi';
import { GoogleSignInButton } from '../components/GoogleSignInButton';

interface NotebooksViewProps {
  bridgeMode: BridgeInfo['mode'];
  notebooks: NotebookItem[];
  notebookEnvs: Record<string, EnvVarEntry[]>;
  loading: boolean;
  startingNotebookId: string | null;
  driveError: string | null;
  isSignedIn: boolean;
  driveConnected: boolean;
  isLoggingIn: boolean;
  runtimes: RuntimeSession[];
  activeRuntimeId: string | null;
  runs: Record<string, NotebookRunState>;
  onSignIn: () => void;
  onRefreshDrive: () => void;
  onOpenGitHubImport: () => void;
  onOpenCliAuth: () => void;
  onOpenNotebookEnv: (nb: NotebookItem) => void;
  onStartNotebook: (nb: NotebookItem, runtimeId: string) => void;
  onStopNotebook: (notebookId: string) => void;
  onRequestDeleteNotebook: (nb: NotebookItem) => void;
}

type StatusFilter = 'all' | 'running' | 'idle';

const AUTO_RUNTIME_OPTIONS = [
  { value: 'auto:CPU', label: 'Auto: CPU' },
  { value: 'auto:T4', label: 'Auto: T4 GPU' },
  { value: 'auto:L4', label: 'Auto: L4 GPU' },
  { value: 'auto:A100', label: 'Auto: A100 GPU' },
];

export function NotebooksView({
  bridgeMode,
  notebooks,
  notebookEnvs,
  loading,
  startingNotebookId,
  driveError,
  isSignedIn,
  driveConnected,
  isLoggingIn,
  runtimes,
  activeRuntimeId,
  runs,
  onSignIn,
  onRefreshDrive,
  onOpenGitHubImport,
  onOpenCliAuth,
  onOpenNotebookEnv,
  onStartNotebook,
  onStopNotebook,
  onRequestDeleteNotebook,
}: NotebooksViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [rowRuntimeMap, setRowRuntimeMap] = useState<Record<string, string>>({});

  const availableRuntimes = useMemo(
    () => runtimes.filter((r) => r.status !== 'stopped'),
    [runtimes]
  );

  const filteredNotebooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notebooks.filter((nb) => {
      if (q && !nb.name.toLowerCase().includes(q)) return false;
      const isRunning = runs[nb.id]?.status === 'running';
      if (statusFilter === 'running' && !isRunning) return false;
      if (statusFilter === 'idle' && isRunning) return false;
      return true;
    });
  }, [notebooks, search, statusFilter, runs]);

  const getRuntimeForRow = (nbId: string): string => {
    const chosen = rowRuntimeMap[nbId];
    if (chosen && (chosen.startsWith('auto:') || availableRuntimes.some((r) => r.id === chosen))) {
      return chosen;
    }
    if (activeRuntimeId && availableRuntimes.some((r) => r.id === activeRuntimeId)) {
      return activeRuntimeId;
    }
    if (availableRuntimes.length > 0) {
      return availableRuntimes[0].id;
    }
    return bridgeMode === 'cli' ? 'auto:CPU' : '';
  };

  return (
    <div className="space-y-4">
      {!isSignedIn && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#111827] px-4 py-3">
          <span className="text-xs text-slate-300">
            Sign in with Google to load your Drive notebooks and save GitHub imports to Drive.
          </span>
          <GoogleSignInButton
            onClick={onSignIn}
            disabled={isLoggingIn}
            label={isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
          />
        </div>
      )}

      {isSignedIn && !driveConnected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-[#111827] px-4 py-3">
          <span className="text-xs text-slate-300">
            Google Drive access expired. Reconnect to sync your notebooks.
          </span>
          <button
            type="button"
            onClick={onSignIn}
            disabled={isLoggingIn}
            className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isLoggingIn ? 'Reconnecting...' : 'Reconnect Drive'}
          </button>
        </div>
      )}

      {driveError && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/35 px-4 py-2.5 text-xs text-red-300">
          {driveError}
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter notebooks..."
              className="w-60 rounded-md border border-slate-800 bg-[#111827] py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center rounded-md border border-slate-800 bg-[#111827] p-0.5">
            {(['all', 'running', 'idle'] as StatusFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === key
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isSignedIn && driveConnected && (
            <button
              type="button"
              onClick={onRefreshDrive}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-[#111827] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Sync Drive</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenGitHubImport}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
          >
            <FolderGit2 className="h-3.5 w-3.5" />
            <span>Import GitHub</span>
          </button>
        </div>
      </div>

      {/* High-density Notebooks Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#111827]">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-800 text-xs font-medium text-slate-400">
              <th className="px-4 py-2.5">Notebook</th>
              <th className="px-4 py-2.5">Source</th>
              <th className="px-4 py-2.5">Modified</th>
              <th className="px-4 py-2.5 text-right">Size</th>
              <th className="px-4 py-2.5">Runtime</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 text-xs">
            {loading && notebooks.length === 0 ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={7} className="px-4 py-3">
                    <div className="h-4 w-full animate-pulse rounded bg-slate-800/70" />
                  </td>
                </tr>
              ))
            ) : filteredNotebooks.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  {notebooks.length === 0
                    ? 'No notebooks found. Sign in with Google Drive or import from GitHub.'
                    : 'No notebooks match the current filter.'}
                </td>
              </tr>
            ) : (
              filteredNotebooks.map((nb) => {
                const run = runs[nb.id];
                const isRunning = run?.status === 'running';
                const isStarting = startingNotebookId === nb.id;
                const assignedRt = getRuntimeForRow(nb.id);
                const envCount = notebookEnvs[nb.id]?.length ?? 0;

                return (
                  <tr key={nb.id} className="transition-colors hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 font-mono font-medium text-slate-200">
                      <div className="max-w-xs truncate">{nb.name}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 capitalize whitespace-nowrap">
                      {nb.source}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {formatRelativeTime(nb.modifiedTime)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {formatBytes(nb.sizeBytes)}
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={assignedRt}
                        disabled={isRunning || isStarting || bridgeMode !== 'cli'}
                        onChange={(e) =>
                          setRowRuntimeMap((prev) => ({ ...prev, [nb.id]: e.target.value }))
                        }
                        className="rounded border border-slate-700 bg-[#0B1120] px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-amber-500 focus:outline-none disabled:opacity-50"
                      >
                        {bridgeMode === 'cli_installing' ? (
                          <option value="">Installing CLI...</option>
                        ) : bridgeMode !== 'cli' ? (
                          <option value="">CLI disconnected</option>
                        ) : (
                          <>
                            {availableRuntimes.map((rt) => (
                              <option key={rt.id} value={rt.id}>
                                {rt.name} ({rt.accelerator})
                              </option>
                            ))}
                            {AUTO_RUNTIME_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </>
                        )}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {isStarting ? (
                        <span className="font-mono text-amber-400">Starting...</span>
                      ) : isRunning ? (
                        <span className="font-mono text-emerald-400 tabular-nums">
                          Running · {run.currentCell}/{run.totalCells}
                        </span>
                      ) : run?.status === 'completed' ? (
                        <span className="text-slate-300">Completed</span>
                      ) : run?.status === 'error' ? (
                        <span className="text-red-400">Error</span>
                      ) : (
                        <span className="text-slate-500">Idle</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenNotebookEnv(nb)}
                          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition-colors ${
                            envCount > 0
                              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                              : 'border-slate-700 bg-[#0B1120] text-slate-300 hover:border-slate-600 hover:text-slate-100'
                          }`}
                          title="Configure environment variables"
                        >
                          <KeyRound className="h-3 w-3" />
                          <span className="font-mono text-[11px] tabular-nums">
                            {envCount > 0 ? `Env (${envCount})` : 'Env'}
                          </span>
                        </button>
                        {isRunning ? (
                          <button
                            type="button"
                            onClick={() => onStopNotebook(nb.id)}
                            className="inline-flex items-center gap-1 rounded border border-red-900/70 bg-red-950/50 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-900/60"
                          >
                            <Square className="h-3 w-3 fill-current" />
                            <span>Stop</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (bridgeMode === 'cli_unauthenticated') {
                                onOpenCliAuth();
                                return;
                              }
                              onStartNotebook(nb, assignedRt || 'auto:CPU');
                            }}
                            disabled={
                              isStarting ||
                              bridgeMode === 'cli_missing' ||
                              bridgeMode === 'cli_installing'
                            }
                            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-100 hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-40"
                          >
                            {isStarting ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3 fill-current" />
                            )}
                            <span>{isStarting ? 'Starting' : 'Start'}</span>
                          </button>
                        )}
                        <a
                          href={nb.webViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open in Colab"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                          aria-label={`Open ${nb.name} in Google Colab`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => onRequestDeleteNotebook(nb)}
                          title="Delete notebook"
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-400"
                          aria-label={`Delete ${nb.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
