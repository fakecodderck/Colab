import { useState } from 'react';
import { FileCode2, FolderGit2, Loader2, X } from 'lucide-react';
import type {
  GitHubDiscoveredFile,
  GitHubFetchedNotebook,
} from '../types';
import {
  fetchGitHubNotebook,
  formatBytes,
  inspectGitHubUrl,
} from '../lib/colabApi';

interface GitHubImportModalProps {
  open: boolean;
  isSignedIn: boolean;
  onClose: () => void;
  onImportComplete: (notebook: GitHubFetchedNotebook) => Promise<void>;
}

export function GitHubImportModal({
  open,
  isSignedIn,
  onClose,
  onImportComplete,
}: GitHubImportModalProps) {
  const [url, setUrl] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoLabel, setRepoLabel] = useState<string | null>(null);
  const [files, setFiles] = useState<GitHubDiscoveredFile[]>([]);
  const [selectedRawUrl, setSelectedRawUrl] = useState<string | null>(null);

  if (!open) return null;

  const resetState = () => {
    setUrl('');
    setError(null);
    setRepoLabel(null);
    setFiles([]);
    setSelectedRawUrl(null);
    setInspecting(false);
    setImporting(false);
  };

  const handleClose = () => {
    if (importing) return;
    resetState();
    onClose();
  };

  const handleInspect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setInspecting(true);
    setFiles([]);
    setSelectedRawUrl(null);

    try {
      const result = await inspectGitHubUrl(url.trim());
      setRepoLabel(result.repoLabel);
      setFiles(result.files);
      if (result.files.length === 0) {
        setError('No .ipynb files found at this GitHub URL.');
      } else {
        setSelectedRawUrl(result.files[0].rawUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to inspect GitHub URL.');
    } finally {
      setInspecting(false);
    }
  };

  const handleImport = async () => {
    if (!selectedRawUrl) return;
    setError(null);
    setImporting(true);
    try {
      const fetched = await fetchGitHubNotebook(selectedRawUrl);
      await onImportComplete(fetched);
      resetState();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="github-import-title"
    >
      <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-[#111827] p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-4 w-4 text-amber-400" />
            <h2 id="github-import-title" className="text-base font-semibold text-slate-100">
              Import from GitHub
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={importing}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleInspect} className="mt-4 flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/blob/main/notebook.ipynb"
            required
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={inspecting || !url.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {inspecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Fetch</span>
          </button>
        </form>

        {error && (
          <div className="mt-3 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {files.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span>{repoLabel}</span>
              <span className="font-mono tabular-nums">
                {files.length} {files.length === 1 ? 'notebook' : 'notebooks'}
              </span>
            </div>

            <div className="max-h-56 divide-y divide-slate-800/80 overflow-y-auto rounded-md border border-slate-800 bg-[#0B1120]">
              {files.map((file) => {
                const isSelected = selectedRawUrl === file.rawUrl;
                return (
                  <button
                    key={file.rawUrl}
                    type="button"
                    onClick={() => setSelectedRawUrl(file.rawUrl)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? 'bg-amber-500/10 text-amber-200'
                        : 'text-slate-300 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileCode2
                        className={`h-4 w-4 shrink-0 ${
                          isSelected ? 'text-amber-400' : 'text-slate-500'
                        }`}
                      />
                      <span className="truncate font-mono text-xs">{file.path}</span>
                    </div>
                    {file.size !== undefined && (
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                        {formatBytes(file.size)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
          <span className="text-xs text-slate-400">
            Destination: {isSignedIn ? 'Google Drive / Colab Notebooks' : 'Workspace session'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={importing}
              className="rounded-md border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={!selectedRawUrl || importing}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{isSignedIn ? 'Save to Drive' : 'Import'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
