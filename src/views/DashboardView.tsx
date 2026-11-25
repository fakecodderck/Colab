import { ArrowRight, KeyRound, Loader2, Play, Square } from 'lucide-react';
import type {
  BridgeInfo,
  EnvVarEntry,
  LogEntry,
  NavSection,
  NotebookItem,
  NotebookRunState,
  RuntimeSession,
  TelemetryPoint,
} from '../types';
import { formatTimestamp, formatUptime } from '../lib/colabApi';
import { TelemetryChart } from '../components/TelemetryChart';

interface DashboardViewProps {
  bridgeMode: BridgeInfo['mode'];
  activeRuntime: RuntimeSession | null;
  runtimes: RuntimeSession[];
  onSelectRuntime: (id: string) => void;
  telemetryPoints: TelemetryPoint[];
  notebooks: NotebookItem[];
  notebookEnvs: Record<string, EnvVarEntry[]>;
  runs: Record<string, NotebookRunState>;
  startingNotebookId: string | null;
  logs: LogEntry[];
  onStartNotebook: (nb: NotebookItem) => void;
  onStopNotebook: (notebookId: string) => void;
  onOpenNotebookEnv: (nb: NotebookItem) => void;
  onNavigate: (section: NavSection) => void;
  onOpenNewRuntime: () => void;
  onOpenCliAuth: () => void;
}

function MetricCard({
  label,
  primary,
  secondary,
  percent,
  barColor,
}: {
  label: string;
  primary: string;
  secondary: string;
  percent: number | null;
  barColor: string;
}) {
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="rounded-lg border border-slate-800 bg-[#111827] p-4">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-slate-300">
          {percent === null ? '—' : `${clamped.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
        {primary}
      </div>
      <div className="mt-1 font-mono text-xs text-slate-400 tabular-nums">{secondary}</div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${clamped}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

export function DashboardView({
  bridgeMode,
  activeRuntime,
  runtimes,
  onSelectRuntime,
  telemetryPoints,
  notebooks,
  notebookEnvs,
  runs,
  startingNotebookId,
  logs,
  onStartNotebook,
  onStopNotebook,
  onOpenNotebookEnv,
  onNavigate,
  onOpenNewRuntime,
  onOpenCliAuth,
}: DashboardViewProps) {
  const activeRuntimes = runtimes.filter((r) => r.status !== 'stopped');
  const latest = activeRuntime?.latestTelemetry ?? null;
  const hasGpu = (activeRuntime?.specs.vramGb ?? 0) > 0;

  const gpuPct = latest && hasGpu ? latest.gpuPercent : null;
  const vramPct =
    latest && hasGpu && latest.vramTotalGb > 0
      ? (latest.vramUsedGb / latest.vramTotalGb) * 100
      : null;
  const ramPct =
    latest && latest.ramTotalGb > 0 ? (latest.ramUsedGb / latest.ramTotalGb) * 100 : null;
  const cpuPct = latest ? latest.cpuPercent : null;
  const diskPct =
    latest && latest.diskTotalGb > 0 ? (latest.diskUsedGb / latest.diskTotalGb) * 100 : null;

  const recentLogs = logs.slice(-10);

  return (
    <div className="space-y-5">
      {/* Runtime selector strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#111827] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-slate-400">Runtime</span>
          {activeRuntimes.length > 0 ? (
            <select
              value={activeRuntime?.id ?? ''}
              onChange={(e) => onSelectRuntime(e.target.value)}
              className="rounded-md border border-slate-700 bg-[#0B1120] px-2.5 py-1 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            >
              {activeRuntimes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name} ({rt.specs.label})
                </option>
              ))}
            </select>
          ) : bridgeMode === 'cli_installing' ? (
            <span className="font-medium text-amber-400">Installing google-colab-cli...</span>
          ) : bridgeMode === 'cli_unauthenticated' ? (
            <button
              type="button"
              onClick={onOpenCliAuth}
              className="font-medium text-amber-400 hover:text-amber-300"
            >
              Colab CLI not connected · Connect Colab CLI
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenNewRuntime}
              disabled={bridgeMode !== 'cli'}
              className="font-medium text-amber-400 hover:text-amber-300 disabled:text-slate-500"
            >
              No active runtime · New Runtime
            </button>
          )}
          {activeRuntime && (
            <div className="flex items-center gap-2 font-mono text-slate-400 tabular-nums">
              <span>{activeRuntime.specs.acceleratorName}</span>
              <span aria-hidden="true">·</span>
              <span>Uptime {formatUptime(activeRuntime.startedAt)}</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  activeRuntime.status === 'busy'
                    ? 'text-amber-400'
                    : activeRuntime.status === 'ready'
                      ? 'text-emerald-400'
                      : 'text-slate-400'
                }
              >
                {activeRuntime.status === 'busy'
                  ? `Running ${activeRuntime.activeNotebookName}`
                  : activeRuntime.status}
              </span>
            </div>
          )}
        </div>

        <span className="font-mono text-xs text-slate-400 tabular-nums">
          Disk{' '}
          {latest && diskPct !== null
            ? `${latest.diskUsedGb.toFixed(1)} / ${latest.diskTotalGb.toFixed(1)} GB (${diskPct.toFixed(0)}%)`
            : '—'}
        </span>
      </div>

      {/* 4-column Resource Metric Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="GPU Compute"
          primary={gpuPct !== null ? `${gpuPct.toFixed(1)}%` : '—'}
          secondary={
            activeRuntime
              ? hasGpu
                ? activeRuntime.specs.label
                : 'CPU-only runtime'
              : 'No active runtime'
          }
          percent={gpuPct}
          barColor="#F59E0B"
        />
        <MetricCard
          label="GPU VRAM"
          primary={hasGpu && latest ? `${latest.vramUsedGb.toFixed(1)} GB` : '—'}
          secondary={
            hasGpu && latest
              ? `of ${latest.vramTotalGb.toFixed(1)} GB`
              : activeRuntime
                ? 'No accelerator memory'
                : 'No active runtime'
          }
          percent={vramPct}
          barColor="#38BDF8"
        />
        <MetricCard
          label="System RAM"
          primary={latest ? `${latest.ramUsedGb.toFixed(1)} GB` : '—'}
          secondary={latest ? `of ${latest.ramTotalGb.toFixed(1)} GB` : 'No active runtime'}
          percent={ramPct}
          barColor="#10B981"
        />
        <MetricCard
          label="CPU Usage"
          primary={cpuPct !== null ? `${cpuPct.toFixed(1)}%` : '—'}
          secondary={
            activeRuntime ? `${activeRuntime.specs.vcpu} vCPU allocated` : 'No active runtime'
          }
          percent={cpuPct}
          barColor="#94A3B8"
        />
      </div>

      {/* Real-time Telemetry Chart */}
      <TelemetryChart points={telemetryPoints} hasGpu={hasGpu} />

      {/* Bottom 2-column Split: Notebooks + Recent Logs */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 items-stretch">
        {/* Active & Recent Notebooks */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-[#111827]">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">Notebooks</h2>
            <button
              type="button"
              onClick={() => onNavigate('notebooks')}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-100"
            >
              <span>All notebooks</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 divide-y divide-slate-800/80">
            {notebooks.slice(0, 6).map((nb) => {
              const run = runs[nb.id];
              const isRunning = run?.status === 'running';
              const isStarting = startingNotebookId === nb.id;
              const envCount = notebookEnvs[nb.id]?.length ?? 0;
              return (
                <div
                  key={nb.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-slate-800/30"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-medium text-slate-200">
                      {nb.name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="capitalize">{nb.source}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          isStarting
                            ? 'text-amber-400'
                            : isRunning
                              ? 'text-emerald-400'
                              : run?.status === 'error'
                                ? 'text-red-400'
                                : 'text-slate-400'
                        }
                      >
                        {isStarting
                          ? 'Starting runtime...'
                          : isRunning
                            ? `Running cell ${run.currentCell}/${run.totalCells}`
                            : run?.status === 'completed'
                              ? 'Completed'
                              : 'Idle'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenNotebookEnv(nb)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-[#0B1120] px-2 py-1.5 text-xs text-slate-300 hover:border-slate-700 hover:text-slate-100 whitespace-nowrap"
                      title="Configure notebook environment variables"
                    >
                      <KeyRound className="h-3 w-3 text-slate-400" />
                      <span className="font-mono text-[11px] tabular-nums">
                        {envCount > 0 ? `Env (${envCount})` : 'Env'}
                      </span>
                    </button>
                    {isRunning ? (
                      <button
                        type="button"
                        onClick={() => onStopNotebook(nb.id)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-900/70 bg-red-950/50 px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-900/60 whitespace-nowrap"
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
                          onStartNotebook(nb);
                        }}
                        disabled={
                          isStarting ||
                          bridgeMode === 'cli_missing' ||
                          bridgeMode === 'cli_installing'
                        }
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-40 whitespace-nowrap"
                      >
                        {isStarting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3 fill-current" />
                        )}
                        <span>{isStarting ? 'Starting' : 'Start'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {notebooks.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-slate-500">
                Sign in with Google or import a notebook from GitHub.
              </div>
            )}
          </div>
        </div>

        {/* Recent Logs Tail */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-[#111827]">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">Recent Logs</h2>
            <button
              type="button"
              onClick={() => onNavigate('logs')}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-100"
            >
              <span>Full logs</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-x-auto p-3 font-mono text-[11px] leading-relaxed">
            {recentLogs.length === 0 ? (
              <div className="py-8 text-center text-slate-500">No log entries yet.</div>
            ) : (
              <div className="space-y-1.5">
                {recentLogs.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2.5">
                    <span className="shrink-0 text-slate-500 tabular-nums">
                      {formatTimestamp(entry.timestamp)}
                    </span>
                    <span
                      className={`w-12 shrink-0 uppercase ${
                        entry.level === 'error'
                          ? 'text-red-400'
                          : entry.level === 'warning'
                            ? 'text-amber-400'
                            : entry.level === 'cli'
                              ? 'text-sky-400'
                              : entry.level === 'stdout'
                                ? 'text-emerald-400'
                                : 'text-slate-400'
                      }`}
                    >
                      {entry.level}
                    </span>
                    <span className="min-w-0 break-words text-slate-300">{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
