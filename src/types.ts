export type NavSection = 'dashboard' | 'notebooks' | 'runtimes' | 'logs';

export type AcceleratorType =
  | 'CPU'
  | 'T4'
  | 'L4'
  | 'A100'
  | 'H100'
  | 'TPU_V5E1'
  | 'TPU_V6E1';

export type RuntimeStatus = 'provisioning' | 'ready' | 'busy' | 'stopped';

export type BridgeMode = 'cli' | 'cli_unauthenticated' | 'cli_installing' | 'cli_missing';

export type NotebookSource = 'drive' | 'github';

export type NotebookRunStatus = 'idle' | 'running' | 'completed' | 'error';

export type LogLevel = 'info' | 'stdout' | 'warning' | 'error' | 'cli';

export interface EnvVarEntry {
  id: string;
  key: string;
  value: string;
}

export interface RuntimeSpecs {
  label: string;
  vcpu: number;
  ramGb: number;
  vramGb: number;
  diskGb: number;
  acceleratorName: string;
  cliFlag: string;
}

export interface TelemetryPoint {
  timestamp: string;
  cpuPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
  gpuPercent: number;
  vramUsedGb: number;
  vramTotalGb: number;
  diskUsedGb: number;
  diskTotalGb: number;
}

export interface RuntimeSession {
  id: string;
  name: string;
  accelerator: AcceleratorType;
  mode: 'cli';
  status: RuntimeStatus;
  startedAt: string;
  activeNotebookId: string | null;
  activeNotebookName: string | null;
  specs: RuntimeSpecs;
  latestTelemetry: TelemetryPoint | null;
}

export interface NotebookRunState {
  notebookId: string;
  notebookName: string;
  runtimeId: string;
  status: NotebookRunStatus;
  startedAt: string;
  currentCell: number;
  totalCells: number;
}

export interface NotebookItem {
  id: string;
  name: string;
  source: NotebookSource;
  modifiedTime: string;
  sizeBytes: number;
  webViewLink: string;
  cellCount?: number;
  githubUrl?: string;
  codeCells?: string[];
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  runtimeId: string | null;
  runtimeName: string | null;
  notebookId: string | null;
  notebookName: string | null;
  message: string;
}

export interface BridgeInfo {
  mode: BridgeMode;
  cliInstalled: boolean;
  cliVersion: string | null;
  authAccount: string | null;
  lastCommand: string | null;
  checkedAt: string;
}

export interface ColabStatePayload {
  bridge: BridgeInfo;
  runtimes: RuntimeSession[];
  runs: Record<string, NotebookRunState>;
  telemetryHistory: Record<string, TelemetryPoint[]>;
  logs: LogEntry[];
}

export interface GitHubDiscoveredFile {
  name: string;
  path: string;
  rawUrl: string;
  blobUrl: string;
  size?: number;
}

export interface GitHubInspectResponse {
  kind: 'file' | 'repo';
  repoLabel: string;
  files: GitHubDiscoveredFile[];
}

export interface GitHubFetchedNotebook {
  fileName: string;
  rawUrl: string;
  blobUrl: string;
  cellCount: number;
  codeCells: string[];
  sizeBytes: number;
  rawJson: string;
}
