import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Search, Trash2 } from 'lucide-react';
import type { LogEntry, LogLevel } from '../types';
import { formatTimestamp } from '../lib/colabApi';

interface LogsViewProps {
  logs: LogEntry[];
  onClearLogs: () => void;
}

const LEVEL_FILTERS: Array<{ id: 'all' | LogLevel; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'cli', label: 'CLI' },
  { id: 'stdout', label: 'Stdout' },
  { id: 'info', label: 'Info' },
  { id: 'warning', label: 'Warn' },
  { id: 'error', label: 'Error' },
];

export function LogsView({ logs, onClearLogs }: LogsViewProps) {
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const entry of logs) {
      if (entry.notebookName) set.add(entry.notebookName);
      if (entry.runtimeName) set.add(entry.runtimeName);
    }
    return Array.from(set).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
      if (
        sourceFilter !== 'all' &&
        entry.notebookName !== sourceFilter &&
        entry.runtimeName !== sourceFilter
      ) {
        return false;
      }
      if (
        q &&
        !entry.message.toLowerCase().includes(q) &&
        !(entry.notebookName?.toLowerCase().includes(q) ?? false) &&
        !(entry.runtimeName?.toLowerCase().includes(q) ?? false)
      ) {
        return false;
      }
      return true;
    });
  }, [logs, search, levelFilter, sourceFilter]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [filteredLogs.length, autoScroll]);

  const handleExport = () => {
    const lines = filteredLogs.map((entry) => {
      const ctx = entry.notebookName || entry.runtimeName || 'system';
      return `${entry.timestamp} [${entry.level.toUpperCase()}] (${ctx}) ${entry.message}`;
    });
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `colabcontrol-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-[calc(100vh-112px)] min-h-[460px] flex-col space-y-3">
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search logs..."
              className="w-52 rounded-md border border-slate-800 bg-[#111827] py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center rounded-md border border-slate-800 bg-[#111827] p-0.5">
            {LEVEL_FILTERS.map((lvl) => (
              <button
                key={lvl.id}
                type="button"
                onClick={() => setLevelFilter(lvl.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  levelFilter === lvl.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lvl.label}
              </button>
            ))}
          </div>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-md border border-slate-800 bg-[#111827] px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
          >
            <option value="all">All sources</option>
            {sources.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 accent-amber-500"
            />
            <span>Auto-scroll</span>
          </label>
          <button
            type="button"
            onClick={onClearLogs}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-[#111827] px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-slate-100 whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={filteredLogs.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export .log</span>
          </button>
        </div>
      </div>

      {/* Streaming Console Output */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-slate-800 bg-[#080D18] p-4 font-mono text-xs leading-relaxed">
        {filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-slate-500">No logs recorded.</div>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 rounded px-1.5 py-0.5 hover:bg-slate-900/70"
              >
                <span className="shrink-0 text-slate-500 tabular-nums">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span
                  className={`w-14 shrink-0 uppercase ${
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
                <span className="w-36 shrink-0 truncate text-slate-500">
                  {entry.notebookName || entry.runtimeName || 'system'}
                </span>
                <span className="min-w-0 flex-1 break-words text-slate-200">{entry.message}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
