import { useState } from 'react';
import type { TelemetryPoint } from '../types';
import { formatTimestamp } from '../lib/colabApi';

interface TelemetryChartProps {
  points: TelemetryPoint[];
  hasGpu: boolean;
}

type MetricKey = 'gpu' | 'vram' | 'ram' | 'cpu';

const SERIES_CONFIG: Record<
  MetricKey,
  { label: string; stroke: string; fill: string }
> = {
  gpu: { label: 'GPU', stroke: '#F59E0B', fill: 'rgba(245, 158, 11, 0.14)' },
  vram: { label: 'VRAM', stroke: '#38BDF8', fill: 'rgba(56, 189, 248, 0.10)' },
  ram: { label: 'RAM', stroke: '#10B981', fill: 'rgba(16, 185, 129, 0.10)' },
  cpu: { label: 'CPU', stroke: '#94A3B8', fill: 'rgba(148, 163, 184, 0.08)' },
};

function getPercent(pt: TelemetryPoint, key: MetricKey): number {
  if (key === 'gpu') return pt.gpuPercent;
  if (key === 'vram') return pt.vramTotalGb > 0 ? (pt.vramUsedGb / pt.vramTotalGb) * 100 : 0;
  if (key === 'ram') return pt.ramTotalGb > 0 ? (pt.ramUsedGb / pt.ramTotalGb) * 100 : 0;
  return pt.cpuPercent;
}

export function TelemetryChart({ points, hasGpu }: TelemetryChartProps) {
  const [visible, setVisible] = useState<Record<MetricKey, boolean>>({
    gpu: true,
    vram: true,
    ram: true,
    cpu: true,
  });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 820;
  const height = 220;
  const padLeft = 38;
  const padRight = 14;
  const padTop = 12;
  const padBottom = 24;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const seriesOrder: MetricKey[] = hasGpu ? ['gpu', 'vram', 'ram', 'cpu'] : ['ram', 'cpu'];
  const data = points.length > 0 ? points : [];

  const getX = (idx: number) => {
    if (data.length <= 1) return padLeft + plotW;
    return padLeft + (idx / (data.length - 1)) * plotW;
  };

  const getY = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    return padTop + plotH - (clamped / 100) * plotH;
  };

  const buildPath = (key: MetricKey) => {
    if (data.length === 0) return '';
    return data
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(getPercent(pt, key)).toFixed(1)}`)
      .join(' ');
  };

  const buildAreaPath = (key: MetricKey) => {
    if (data.length < 2) return '';
    const line = buildPath(key);
    const lastX = getX(data.length - 1).toFixed(1);
    const firstX = getX(0).toFixed(1);
    const baseY = (padTop + plotH).toFixed(1);
    return `${line} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
  };

  const toggleMetric = (key: MetricKey) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const activePoint =
    hoverIdx !== null && data[hoverIdx]
      ? data[hoverIdx]
      : data.length > 0
        ? data[data.length - 1]
        : null;

  return (
    <div className="rounded-lg border border-slate-800 bg-[#111827] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-100">Resource Utilization</h2>
          {activePoint && (
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {formatTimestamp(activePoint.timestamp)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {seriesOrder.map((key) => {
            const cfg = SERIES_CONFIG[key];
            const isOn = visible[key];
            const val = activePoint ? getPercent(activePoint, key) : null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleMetric(key)}
                className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition-colors whitespace-nowrap shrink-0 ${
                  isOn
                    ? 'border-slate-700 bg-slate-800/80 text-slate-100'
                    : 'border-slate-800 bg-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                <span
                  className="h-2 w-2 rounded-xs"
                  style={{ backgroundColor: isOn ? cfg.stroke : '#475569' }}
                />
                <span>{cfg.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-slate-300">
                  {val === null ? '—' : `${val.toFixed(0)}%`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center rounded-md border border-dashed border-slate-800 bg-[#0B1120] text-xs text-slate-500">
          No live telemetry data. Connect a Colab runtime via google-colab-cli.
        </div>
      ) : (
        <div className="relative w-full overflow-hidden">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-[220px] w-full select-none"
            onMouseLeave={() => setHoverIdx(null)}
            onMouseMove={(e) => {
              if (data.length === 0) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * width;
              const clamped = Math.max(padLeft, Math.min(padLeft + plotW, relX));
              const ratio = (clamped - padLeft) / plotW;
              const idx = Math.round(ratio * (data.length - 1));
              setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)));
            }}
          >
          {/* Horizontal percentage gridlines */}
          {[0, 25, 50, 75, 100].map((pct) => {
            const y = getY(pct);
            return (
              <g key={pct}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={padLeft + plotW}
                  y2={y}
                  stroke="#1E293B"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fill="#64748B"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {pct}%
                </text>
              </g>
            );
          })}

          {/* Area fills + series strokes */}
          {seriesOrder.map((key) => {
            if (!visible[key] || data.length === 0) return null;
            const cfg = SERIES_CONFIG[key];
            return (
              <g key={key}>
                {key === (hasGpu ? 'gpu' : 'ram') && (
                  <path d={buildAreaPath(key)} fill={cfg.fill} />
                )}
                <path
                  d={buildPath(key)}
                  fill="none"
                  stroke={cfg.stroke}
                  strokeWidth="1.75"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            );
          })}

          {/* Hover vertical guideline and markers */}
          {hoverIdx !== null && data[hoverIdx] && (
            <g>
              <line
                x1={getX(hoverIdx)}
                y1={padTop}
                x2={getX(hoverIdx)}
                y2={padTop + plotH}
                stroke="#475569"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              {seriesOrder.map((key) => {
                if (!visible[key]) return null;
                const val = getPercent(data[hoverIdx], key);
                return (
                  <circle
                    key={key}
                    cx={getX(hoverIdx)}
                    cy={getY(val)}
                    r="3.2"
                    fill={SERIES_CONFIG[key].stroke}
                    stroke="#0B1120"
                    strokeWidth="1.5"
                  />
                );
              })}
            </g>
          )}

          {/* X-axis start/mid/end timestamps */}
          {data.length > 1 &&
            [0, Math.floor(data.length / 2), data.length - 1].map((idx) => (
              <text
                key={idx}
                x={getX(idx)}
                y={height - 5}
                textAnchor={idx === 0 ? 'start' : idx === data.length - 1 ? 'end' : 'middle'}
                fill="#64748B"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {formatTimestamp(data[idx].timestamp)}
              </text>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
