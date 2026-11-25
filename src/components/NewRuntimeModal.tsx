import { useState } from 'react';
import { Cpu, Loader2, X } from 'lucide-react';
import type { AcceleratorType } from '../types';

interface NewRuntimeModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, accelerator: AcceleratorType) => Promise<void>;
}

const HARDWARE_TIERS: Array<{
  id: AcceleratorType;
  label: string;
  specs: string;
  cliFlag: string;
}> = [
  { id: 'T4', label: 'NVIDIA T4', specs: '2 vCPU · 12.7 GB RAM · 15 GB VRAM', cliFlag: '--gpu T4' },
  { id: 'L4', label: 'NVIDIA L4', specs: '12 vCPU · 53.0 GB RAM · 22.5 GB VRAM', cliFlag: '--gpu L4' },
  { id: 'A100', label: 'NVIDIA A100', specs: '12 vCPU · 83.5 GB RAM · 40 GB VRAM', cliFlag: '--gpu A100' },
  { id: 'H100', label: 'NVIDIA H100', specs: '26 vCPU · 167 GB RAM · 80 GB VRAM', cliFlag: '--gpu H100' },
  { id: 'TPU_V5E1', label: 'TPU v5e-1', specs: '24 vCPU · 47.0 GB RAM · 16 GB HBM', cliFlag: '--tpu v5e1' },
  { id: 'TPU_V6E1', label: 'TPU v6e-1', specs: '44 vCPU · 173 GB RAM · 32 GB HBM', cliFlag: '--tpu v6e1' },
  { id: 'CPU', label: 'Standard CPU', specs: '2 vCPU · 12.7 GB RAM · No GPU', cliFlag: '' },
];

export function NewRuntimeModal({ open, onClose, onCreate }: NewRuntimeModalProps) {
  const [name, setName] = useState('gpu-worker-1');
  const [accelerator, setAccelerator] = useState<AcceleratorType>('T4');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const selectedTier = HARDWARE_TIERS.find((t) => t.id === accelerator) ?? HARDWARE_TIERS[0];
  const cliCommand = selectedTier.cliFlag
    ? `colab new -s ${name.trim() || 'session'} ${selectedTier.cliFlag}`
    : `colab new -s ${name.trim() || 'session'}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await onCreate(name.trim(), accelerator);
      setName(`worker-${Math.floor(10 + Math.random() * 89)}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create runtime.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-runtime-title"
    >
      <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-[#111827] p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-amber-400" />
            <h2 id="new-runtime-title" className="text-base font-semibold text-slate-100">
              New Colab Runtime
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="session-name" className="block text-xs font-medium text-slate-300">
              Session Name
            </label>
            <input
              id="session-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}"
              required
              placeholder="t4-training"
              className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-300">Hardware Accelerator</span>
            <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {HARDWARE_TIERS.map((tier) => {
                const isSelected = accelerator === tier.id;
                return (
                  <button
                    key={tier.id}
                    type="button"
                    onClick={() => setAccelerator(tier.id)}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? 'border-amber-500/80 bg-amber-500/10'
                        : 'border-slate-800 bg-[#0B1120] hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-100">{tier.label}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
                      {tier.specs}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 font-mono text-xs text-slate-300">
            <span className="text-slate-500">$ </span>
            {cliCommand}
          </div>

          {error && (
            <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="rounded-md border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Provision Runtime</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
