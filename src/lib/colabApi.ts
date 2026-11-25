import type {
  AcceleratorType,
  BridgeInfo,
  ColabStatePayload,
  GitHubFetchedNotebook,
  GitHubInspectResponse,
  NotebookRunState,
  RuntimeSession,
} from '../types';

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'ColabControl',
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export function fetchColabState(): Promise<ColabStatePayload> {
  return apiRequest<ColabStatePayload>('/api/colab/state');
}

export function probeColabBridge(): Promise<BridgeInfo> {
  return apiRequest<BridgeInfo>('/api/colab/probe', { method: 'POST' });
}

export function startColabCliAuth(): Promise<{ flowId: string; authUrl: string }> {
  return apiRequest<{ flowId: string; authUrl: string }>('/api/colab/auth/start', {
    method: 'POST',
  });
}

export function completeColabCliAuth(
  flowId: string,
  code: string
): Promise<{ ok: boolean; bridge: BridgeInfo }> {
  return apiRequest<{ ok: boolean; bridge: BridgeInfo }>('/api/colab/auth/complete', {
    method: 'POST',
    body: JSON.stringify({ flowId, code }),
  });
}

export function disconnectColabCliAuth(): Promise<{ ok: boolean; bridge: BridgeInfo }> {
  return apiRequest<{ ok: boolean; bridge: BridgeInfo }>('/api/colab/auth/disconnect', {
    method: 'POST',
  });
}

export function syncColabSessions(): Promise<{ runtimes: RuntimeSession[] }> {
  return apiRequest<{ runtimes: RuntimeSession[] }>('/api/colab/sessions/sync', {
    method: 'POST',
  });
}

export function createRuntime(
  name: string,
  accelerator: AcceleratorType
): Promise<RuntimeSession> {
  return apiRequest<RuntimeSession>('/api/colab/runtimes', {
    method: 'POST',
    body: JSON.stringify({ name, accelerator }),
  });
}

export function stopRuntime(runtimeId: string): Promise<{ ok: boolean; runtime: RuntimeSession }> {
  return apiRequest<{ ok: boolean; runtime: RuntimeSession }>(
    `/api/colab/runtimes/${encodeURIComponent(runtimeId)}`,
    { method: 'DELETE' }
  );
}

export function startNotebookExecution(payload: {
  notebookId: string;
  notebookName: string;
  runtimeId: string;
  cells: string[];
  env?: Record<string, string>;
}): Promise<{ ok: boolean; run: NotebookRunState; runtime: RuntimeSession }> {
  return apiRequest<{ ok: boolean; run: NotebookRunState; runtime: RuntimeSession }>(
    '/api/colab/notebooks/start',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export function stopNotebookExecution(notebookId: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/colab/notebooks/stop', {
    method: 'POST',
    body: JSON.stringify({ notebookId }),
  });
}

export function clearServerLogs(): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/colab/logs', { method: 'DELETE' });
}

export function inspectGitHubUrl(url: string): Promise<GitHubInspectResponse> {
  return apiRequest<GitHubInspectResponse>('/api/github/inspect', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export function fetchGitHubNotebook(rawUrl: string): Promise<GitHubFetchedNotebook> {
  return apiRequest<GitHubFetchedNotebook>('/api/github/fetch', {
    method: 'POST',
    body: JSON.stringify({ rawUrl }),
  });
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return 'Just now';
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatUptime(startedAt: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const totalSec = Math.floor(diffMs / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
