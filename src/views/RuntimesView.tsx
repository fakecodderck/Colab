import { useState } from 'react';
import { Check, Copy, LogOut, Plus, RefreshCw, Square, Terminal } from 'lucide-react';
import type { BridgeInfo, RuntimeSession } from '../types';
import { formatUptime } from '../lib/colabApi';

interface RuntimesViewProps {
  bridge: BridgeInfo;
  runtimes: RuntimeSession[];
  activeRuntimeId: string | null;
  onSelectRuntime: (id: string) => void;
  onOpenNewRuntime: () => void;
  onOpenCliAuth: () => void;
  onDisconnectCli: () => Promise<void>;
  onRequestStopRuntime: (rt: RuntimeSession) => void;
  onProbeBridge: () => Promise<void>;
  onSyncSessions: () => Promise<void>;
}

export function RuntimesView({
  bridge,
  runtimes,
  activeRuntimeId,
  onSelectRuntime,
  onOpenNewRuntime,
  onOpenCliAuth,
  onDisconnectCli,
  onRequestStopRuntime,
  onProbeBridge,
  onSyncSessions,
}: RuntimesViewProps) {
  const [probing, setProbing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleProbe = async () => {
    setProbing(true);
    try {
      await onProbeBridge();
    } finally {
      setProbing(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSyncSessions();
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await onDisconnectCli();
    } finally {
      setDisconnecting(false);
    }
  };

  const handleCopyLastCmd = async () => {
    if (!bridge.lastCommand) return;
    try {
      await navigator.clipboard.writeText(bridge.lastCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const versionTag = bridge.cliVersion ? `v${bridge.cliVersion}` : '';
  const modeLabel =
    bridge.mode === 'cli'
      ? `google-colab-cli ${versionTag}`.trim()
      : bridge.mode === 'cli_unauthenticated'
        ? `google-colab-cli ${versionTag} · Not connected`.trim()
        : bridge.mode === 'cli_installing'
          ? 'Installing google-colab-cli...'
          : 'Not installed';

  return (
    <div className="space-y-4">
      {/* Compact CLI Bridge Status Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#111827] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-slate-400">Colab CLI</span>
          <span
            className={`font-mono font-medium ${
              bridge.mode === 'cli'
                ? 'text-emerald-400'
                : bridge.mode === 'cli_unauthenticated' || bridge.mode === 'cli_installing'
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}
          >
            {modeLabel}
          </span>
          {bridge.authAccount && (
            <>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-slate-300">{bridge.authAccount}</span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {bridge.lastCommand && (
            <button
              type="button"
              onClick={handleCopyLastCmd}
              className="inline-flex items-center gap-1.5 rounded border border-slate-800 bg-[#0B1120] px-2.5 py-1 font-mono text-[11px] text-slate-300 hover:border-slate-700"
              title="Copy last colab CLI command"
            >
              <span className="max-w-[220px] truncate">$ {bridge.lastCommand}</span>
              {copied ? (
                <Check className="h-3 w-3 text-emerald-400 shrink-0" />
              ) : (
                <Copy className="h-3 w-3 text-slate-500 shrink-0" />
              )}
            </button>
          )}
          {bridge.mode === 'cli' && (
            <>
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>Sync Sessions</span>
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Disconnect CLI</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleProbe}
            disabled={probing || bridge.mode === 'cli_installing'}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${probing || bridge.mode === 'cli_installing' ? 'animate-spin' : ''}`}
            />
            <span>{bridge.mode === 'cli_installing' ? 'Installing...' : 'Check CLI'}</span>
          </button>
          {bridge.mode === 'cli_unauthenticated' ? (
            <button
              type="button"
              onClick={onOpenCliAuth}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>Connect Colab CLI</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenNewRuntime}
              disabled={bridge.mode !== 'cli'}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Runtime</span>
            </button>
          )}
        </div>
      </div>

      {/* Runtimes Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#111827]">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-800 text-xs font-medium text-slate-400">
              <th className="px-4 py-2.5">Session</th>
              <th className="px-4 py-2.5">Accelerator</th>
              <th className="px-4 py-2.5">Resources</th>
              <th className="px-4 py-2.5">Active Notebook</th>
              <th className="px-4 py-2.5">Uptime</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 text-xs">
            {runtimes.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  {bridge.mode === 'cli'
                    ? 'No active Colab sessions. Click New Runtime or Sync Sessions.'
                    : bridge.mode === 'cli_unauthenticated'
                      ? 'Click Connect Colab CLI to sign in and manage live Colab runtimes.'
                      : bridge.mode === 'cli_installing'
                        ? 'Installing google-colab-cli on the server...'
                        : 'Click Check CLI to install google-colab-cli on the server.'}
                </td>
              </tr>
            ) : (
              runtimes.map((rt) => {
                const isSelected = rt.id === activeRuntimeId;
                const isStopped = rt.status === 'stopped';
                return (
                  <tr
                    key={rt.id}
                    className={`transition-colors hover:bg-slate-800/30 ${
                      isSelected ? 'bg-slate-800/20' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono font-medium text-slate-200 whitespace-nowrap">
                      {rt.name}
                      {isSelected && !isStopped && (
                        <span className="ml-2 font-sans text-[11px] text-amber-400">Default</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap">
                      {rt.specs.label}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {rt.specs.vcpu} vCPU · {rt.specs.ramGb} GB RAM
                      {rt.specs.vramGb > 0 ? ` · ${rt.specs.vramGb} GB VRAM` : ''}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">
                      <div className="max-w-[200px] truncate">
                        {rt.activeNotebookName ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {isStopped ? '—' : formatUptime(rt.startedAt)}
                    </td>
                    <td className="px-4 py-2.5 capitalize whitespace-nowrap">
                      <span
                        className={
                          rt.status === 'ready'
                            ? 'text-emerald-400'
                            : rt.status === 'busy' || rt.status === 'provisioning'
                              ? 'text-amber-400'
                              : 'text-slate-500'
                        }
                      >
                        {rt.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2">
                        {!isStopped && !isSelected && (
                          <button
                            type="button"
                            onClick={() => onSelectRuntime(rt.id)}
                            className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-amber-500/60 hover:text-amber-300"
                          >
                            Use
                          </button>
                        )}
                        {!isStopped && (
                          <button
                            type="button"
                            onClick={() => onRequestStopRuntime(rt)}
                            className="inline-flex items-center gap-1 rounded border border-red-900/70 bg-red-950/50 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-900/60"
                          >
                            <Square className="h-3 w-3 fill-current" />
                            <span>Stop</span>
                          </button>
                        )}
                        {isStopped && <span className="text-slate-600">Terminated</span>}
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
