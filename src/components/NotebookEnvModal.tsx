import { useEffect, useState } from 'react';
import { Eye, EyeOff, FileText, KeyRound, Plus, Trash2, X } from 'lucide-react';
import type { EnvVarEntry, NotebookItem } from '../types';

interface NotebookEnvModalProps {
  notebook: NotebookItem | null;
  initialEntries: EnvVarEntry[];
  onClose: () => void;
  onSave: (notebookId: string, entries: EnvVarEntry[]) => void;
}

const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

function createEmptyRow(): EnvVarEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    key: '',
    value: '',
  };
}

export function NotebookEnvModal({
  notebook,
  initialEntries,
  onClose,
  onSave,
}: NotebookEnvModalProps) {
  const [rows, setRows] = useState<EnvVarEntry[]>([]);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!notebook) return;
    setRows(initialEntries.length > 0 ? initialEntries.map((e) => ({ ...e })) : [createEmptyRow()]);
    setRevealedIds(new Set());
    setPasteMode(false);
    setPasteText('');
    setError(null);
  }, [notebook, initialEntries]);

  if (!notebook) return null;

  const updateRow = (id: string, field: 'key' | 'value', val: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
    setError(null);
  };

  const removeRow = (id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length > 0 ? next : [createEmptyRow()];
    });
    setError(null);
  };

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleParseDotEnv = () => {
    const lines = pasteText.split(/\r?\n/);
    const parsed: EnvVarEntry[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const cleaned = line.startsWith('export ') ? line.slice(7).trim() : line;
      const eqIdx = cleaned.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = cleaned.slice(0, eqIdx).trim();
      let value = cleaned.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (ENV_KEY_REGEX.test(key)) {
        parsed.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          key,
          value,
        });
      }
    }

    if (parsed.length === 0) {
      setError('No valid KEY=VALUE lines found.');
      return;
    }

    setRows((prev) => {
      const byKey = new Map<string, EnvVarEntry>();
      for (const r of prev) {
        if (r.key.trim()) byKey.set(r.key.trim(), r);
      }
      for (const p of parsed) {
        byKey.set(p.key, p);
      }
      return Array.from(byKey.values());
    });
    setPasteMode(false);
    setPasteText('');
    setError(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned: EnvVarEntry[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const k = row.key.trim();
      if (!k && !row.value) continue;
      if (!ENV_KEY_REGEX.test(k)) {
        setError(`Invalid key "${k || '(empty)'}". Use letters, numbers, and underscores.`);
        return;
      }
      if (seen.has(k)) {
        setError(`Duplicate variable "${k}".`);
        return;
      }
      seen.add(k);
      cleaned.push({ id: row.id, key: k, value: row.value });
    }

    onSave(notebook.id, cleaned);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notebook-env-title"
    >
      <div className="w-full max-w-xl rounded-lg border border-slate-800 bg-[#111827] p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0 text-amber-400" />
            <h2 id="notebook-env-title" className="truncate text-base font-semibold text-slate-100">
              Env · <span className="font-mono text-sm text-slate-300">{notebook.name}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Injected into <code className="font-mono text-slate-300">os.environ</code> on start
            </span>
            <button
              type="button"
              onClick={() => {
                setPasteMode((v) => !v);
                setError(null);
              }}
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>{pasteMode ? 'Back to rows' : 'Paste .env'}</span>
            </button>
          </div>

          {pasteMode ? (
            <div className="space-y-2">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={6}
                placeholder={'HF_TOKEN=hf_...\nWANDB_API_KEY=...'}
                className="w-full rounded-md border border-slate-700 bg-[#0B1120] p-3 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleParseDotEnv}
                  className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
                >
                  Parse lines
                </button>
              </div>
            </div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {rows.map((row) => {
                const revealed = revealedIds.has(row.id);
                return (
                  <div key={row.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.key}
                      onChange={(e) => updateRow(row.id, 'key', e.target.value)}
                      placeholder="KEY_NAME"
                      spellCheck={false}
                      autoComplete="off"
                      className="w-44 shrink-0 rounded-md border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                    />
                    <div className="relative min-w-0 flex-1">
                      <input
                        type={revealed ? 'text' : 'password'}
                        value={row.value}
                        onChange={(e) => updateRow(row.id, 'value', e.target.value)}
                        placeholder="value"
                        spellCheck={false}
                        autoComplete="off"
                        className="w-full rounded-md border border-slate-700 bg-[#0B1120] py-1.5 pl-2.5 pr-8 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => toggleReveal(row.id)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        aria-label={revealed ? 'Hide value' : 'Show value'}
                      >
                        {revealed ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-400 shrink-0"
                      aria-label="Remove variable"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => setRows((prev) => [...prev, createEmptyRow()])}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-slate-600 hover:text-slate-200"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add variable</span>
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
            >
              Save Env
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
