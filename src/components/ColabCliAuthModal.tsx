import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Terminal, X } from 'lucide-react';
import type { BridgeInfo } from '../types';
import { completeColabCliAuth, startColabCliAuth } from '../lib/colabApi';

interface ColabCliAuthModalProps {
  open: boolean;
  onClose: () => void;
  onConnected: (bridge: BridgeInfo) => void;
}

export function ColabCliAuthModal({ open, onClose, onConnected }: ColabCliAuthModalProps) {
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingUrl(true);
    setError(null);
    setCode('');
    setFlowId(null);
    setAuthUrl(null);

    startColabCliAuth()
      .then((res) => {
        if (!cancelled) {
          setFlowId(res.flowId);
          setAuthUrl(res.authUrl);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to initialize Colab CLI login.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingUrl(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flowId || !code.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await completeColabCliAuth(flowId, code.trim());
      onConnected(res.bridge);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="colab-cli-auth-title"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-800 bg-[#111827] p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-amber-400" />
            <h2 id="colab-cli-auth-title" className="text-base font-semibold text-slate-100">
              Connect Google Colab CLI
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-300">1. Authorize in Google</div>
            {loadingUrl ? (
              <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Generating Google auth URL...</span>
              </div>
            ) : authUrl ? (
              <a
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 transition-colors hover:border-amber-500/60 hover:text-amber-300"
              >
                <span>Open Google Sign-In</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="colab-auth-code" className="block text-xs font-medium text-slate-300">
              2. Paste Authorization Code
            </label>
            <input
              id="colab-auth-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="4/0A..."
              required
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!flowId || !code.trim() || submitting}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Connect CLI</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
