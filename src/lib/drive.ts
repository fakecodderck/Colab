import type { NotebookItem } from '../types';
import { getAccessToken } from './auth';

export class DriveSessionExpiredError extends Error {
  constructor(message = 'Google Drive access expired. Reconnect to continue.') {
    super(message);
    this.name = 'DriveSessionExpiredError';
  }
}

function buildHeaders(includeJson = false): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'ColabControl',
  };
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function driveRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      ...buildHeaders(Boolean(init?.body)),
      ...(init?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && (data as { code?: string }).code === 'DRIVE_TOKEN_EXPIRED') {
    throw new DriveSessionExpiredError((data as { error?: string }).error);
  }
  if (!res.ok) {
    throw new Error(
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Google Drive request failed (HTTP ${res.status})`
    );
  }
  return data as T;
}

export async function listDriveNotebooks(): Promise<NotebookItem[]> {
  const data = await driveRequest<{ files: NotebookItem[] }>('/api/drive/notebooks');
  return data.files ?? [];
}

export async function downloadDriveNotebookCells(
  fileId: string
): Promise<{ cellCount: number; codeCells: string[] }> {
  return driveRequest<{ cellCount: number; codeCells: string[] }>(
    `/api/drive/notebooks/${encodeURIComponent(fileId)}/cells`
  );
}

export async function findExistingDriveNotebook(
  fileName: string
): Promise<{ id: string; name: string } | null> {
  const data = await driveRequest<{ existing: { id: string; name: string } | null }>(
    `/api/drive/notebooks/check?name=${encodeURIComponent(fileName)}`
  );
  return data.existing ?? null;
}

export async function saveNotebookToDrive(
  fileName: string,
  rawJson: string,
  overwriteFileId?: string
): Promise<NotebookItem> {
  return driveRequest<NotebookItem>('/api/drive/notebooks/save', {
    method: 'POST',
    body: JSON.stringify({ fileName, rawJson, overwriteFileId }),
  });
}

export async function deleteDriveNotebook(fileId: string): Promise<void> {
  await driveRequest<{ ok: boolean }>(`/api/drive/notebooks/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
  });
}
