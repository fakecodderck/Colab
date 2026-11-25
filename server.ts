import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import type {
  AcceleratorType,
  BridgeInfo,
  ColabStatePayload,
  GitHubDiscoveredFile,
  LogEntry,
  LogLevel,
  NotebookRunState,
  RuntimeSession,
  RuntimeSpecs,
  TelemetryPoint,
} from './src/types.ts';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedColabRoot: string | null = null;

function getColabPaths() {
  if (!cachedColabRoot) {
    let root = __dirname;
    try {
      fs.accessSync(root, fs.constants.W_OK);
    } catch {
      root = path.join(os.tmpdir(), 'colabcontrol-runtime');
      fs.mkdirSync(root, { recursive: true, mode: 0o755 });
    }
    cachedColabRoot = root;
  }
  const venvDir = path.join(cachedColabRoot, '.colab-venv');
  const toolsDir = path.join(cachedColabRoot, '.colab-tools');
  return {
    root: cachedColabRoot,
    venvDir,
    venvBin: path.join(venvDir, 'bin', 'colab'),
    venvPython: path.join(venvDir, 'bin', 'python'),
    toolsDir,
    uvBin: path.join(toolsDir, 'uv'),
    pythonInstallDir: path.join(toolsDir, 'python'),
    uvCacheDir: path.join(os.tmpdir(), 'colabcontrol-uv-cache'),
  };
}

function resolveColabBin(): string {
  const { venvBin } = getColabPaths();
  return fs.existsSync(venvBin) ? venvBin : 'colab';
}

function resolveColabPython(): string {
  const { venvPython } = getColabPaths();
  return fs.existsSync(venvPython) ? venvPython : 'python3';
}

// In-memory authorized_user credentials JSON for google-colab-cli (--auth=adc)
let cliCredentialsJson: string | null = null;
const pendingCliAuthFlows = new Map<string, { codeVerifier: string | null; createdAt: number }>();

function createEphemeralCredsFile(): string | null {
  if (!cliCredentialsJson) return null;
  const tmpPath = path.join(os.tmpdir(), `colabcontrol-adc-${crypto.randomBytes(12).toString('hex')}.json`);
  fs.writeFileSync(tmpPath, cliCredentialsJson, { mode: 0o600 });
  return tmpPath;
}

function removeFileSafe(filePath: string | null): void {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup errors
  }
}

async function execColabCli(
  args: string[],
  timeoutMs = 20000
): Promise<{ stdout: string; stderr: string }> {
  const bin = resolveColabBin();
  const tmpCreds = createEphemeralCredsFile();
  const fullArgs = tmpCreds ? ['--auth=adc', ...args] : args;
  const env: NodeJS.ProcessEnv = tmpCreds
    ? { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: tmpCreds }
    : process.env;
  try {
    return await execFileAsync(bin, fullArgs, { timeout: timeoutMs, env });
  } finally {
    removeFileSafe(tmpCreds);
  }
}

function spawnColabCli(args: string[]): {
  child: ChildProcessWithoutNullStreams;
  cleanup: () => void;
} {
  const bin = resolveColabBin();
  const tmpCreds = createEphemeralCredsFile();
  const fullArgs = tmpCreds ? ['--auth=adc', ...args] : args;
  const env: NodeJS.ProcessEnv = tmpCreds
    ? { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: tmpCreds }
    : process.env;
  const child = spawn(bin, fullArgs, { shell: false, env, stdio: 'pipe' });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    removeFileSafe(tmpCreds);
  };
  child.once('close', cleanup);
  child.once('error', cleanup);
  return { child, cleanup };
}

const ACCELERATOR_SPECS: Record<AcceleratorType, RuntimeSpecs> = {
  CPU: {
    label: 'Standard CPU',
    vcpu: 2,
    ramGb: 12.7,
    vramGb: 0,
    diskGb: 107.7,
    acceleratorName: 'Intel Xeon 2 vCPU',
    cliFlag: '',
  },
  T4: {
    label: 'NVIDIA T4',
    vcpu: 2,
    ramGb: 12.7,
    vramGb: 15.0,
    diskGb: 78.2,
    acceleratorName: 'NVIDIA Tesla T4',
    cliFlag: '--gpu T4',
  },
  L4: {
    label: 'NVIDIA L4',
    vcpu: 12,
    ramGb: 53.0,
    vramGb: 22.5,
    diskGb: 112.6,
    acceleratorName: 'NVIDIA L4',
    cliFlag: '--gpu L4',
  },
  A100: {
    label: 'NVIDIA A100',
    vcpu: 12,
    ramGb: 83.5,
    vramGb: 40.0,
    diskGb: 235.7,
    acceleratorName: 'NVIDIA A100-SXM4',
    cliFlag: '--gpu A100',
  },
  H100: {
    label: 'NVIDIA H100',
    vcpu: 26,
    ramGb: 167.0,
    vramGb: 80.0,
    diskGb: 235.7,
    acceleratorName: 'NVIDIA H100-80GB',
    cliFlag: '--gpu H100',
  },
  TPU_V5E1: {
    label: 'TPU v5e-1',
    vcpu: 24,
    ramGb: 47.0,
    vramGb: 16.0,
    diskGb: 225.3,
    acceleratorName: 'Google TPU v5e-1',
    cliFlag: '--tpu V5E1',
  },
  TPU_V6E1: {
    label: 'TPU v6e-1',
    vcpu: 44,
    ramGb: 173.0,
    vramGb: 32.0,
    diskGb: 225.3,
    acceleratorName: 'Google TPU v6e-1',
    cliFlag: '--tpu V6E1',
  },
};

const VALID_ACCELERATORS = new Set<string>(Object.keys(ACCELERATOR_SPECS));
const SESSION_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;
const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_ENV_VARS = 100;
const MAX_ENV_VAL_LENGTH = 16384;
const ALLOWED_GITHUB_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'raw.githubusercontent.com',
]);
const MAX_NOTEBOOK_BYTES = 10 * 1024 * 1024; // 10 MB cap
const MAX_HISTORY_POINTS = 60;
const MAX_LOGS = 400;

// Real Python telemetry snippet executed on live Colab runtimes via `colab exec`
const TELEMETRY_PROBE_PY = `
import json, os, shutil, subprocess
def read_cpu():
    try:
        import psutil
        return round(psutil.cpu_percent(interval=0.2), 1)
    except Exception:
        load = os.getloadavg()[0]
        cores = os.cpu_count() or 1
        return round(min(100.0, (load / cores) * 100.0), 1)
def read_ram():
    try:
        import psutil
        vm = psutil.virtual_memory()
        return round((vm.total - vm.available) / (1024**3), 2), round(vm.total / (1024**3), 2)
    except Exception:
        info = {}
        with open('/proc/meminfo') as f:
            for line in f:
                k, v = line.split(':', 1)
                info[k.strip()] = int(v.strip().split()[0])
        total = info.get('MemTotal', 0) / (1024**2)
        avail = info.get('MemAvailable', info.get('MemFree', 0)) / (1024**2)
        return round(total - avail, 2), round(total, 2)
def read_gpu():
    try:
        out = subprocess.check_output(
            ['nvidia-smi', '--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
            stderr=subprocess.DEVNULL, text=True, timeout=3
        ).strip().splitlines()[0]
        parts = [float(x.strip()) for x in out.split(',')]
        return round(parts[0], 1), round(parts[1] / 1024.0, 2), round(parts[2] / 1024.0, 2)
    except Exception:
        return 0.0, 0.0, 0.0
ram_u, ram_t = read_ram()
gpu_p, vram_u, vram_t = read_gpu()
disk = shutil.disk_usage('/content' if os.path.exists('/content') else '/')
print(json.dumps({
    "cpuPercent": read_cpu(),
    "ramUsedGb": ram_u,
    "ramTotalGb": ram_t,
    "gpuPercent": gpu_p,
    "vramUsedGb": vram_u,
    "vramTotalGb": vram_t,
    "diskUsedGb": round(disk.used / (1024**3), 2),
    "diskTotalGb": round(disk.total / (1024**3), 2)
}))
`.trim();

interface ActiveExecutionHandle {
  abort: () => void;
}

const bridgeInfo: BridgeInfo = {
  mode: 'cli_missing',
  cliInstalled: false,
  cliVersion: null,
  authAccount: null,
  lastCommand: null,
  checkedAt: new Date().toISOString(),
};

const runtimes = new Map<string, RuntimeSession>();
const telemetryHistory = new Map<string, TelemetryPoint[]>();
const runs = new Map<string, NotebookRunState>();
const activeExecutions = new Map<string, ActiveExecutionHandle>();
const logs: LogEntry[] = [];
const sseClients = new Set<Response>();
let pollingTelemetry = false;

function appendLog(
  level: LogLevel,
  message: string,
  meta?: {
    runtimeId?: string | null;
    runtimeName?: string | null;
    notebookId?: string | null;
    notebookName?: string | null;
  }
): LogEntry {
  const entry: LogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    runtimeId: meta?.runtimeId ?? null,
    runtimeName: meta?.runtimeName ?? null,
    notebookId: meta?.notebookId ?? null,
    notebookName: meta?.notebookName ?? null,
    message,
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  broadcastEvent('log', entry);
  return entry;
}

function broadcastEvent(event: string, payload: unknown): void {
  const serialized = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(serialized);
    } catch {
      sseClients.delete(res);
    }
  }
}

function getFullState(): ColabStatePayload {
  const historyObj: Record<string, TelemetryPoint[]> = {};
  for (const [id, pts] of telemetryHistory.entries()) {
    historyObj[id] = pts;
  }
  const runsObj: Record<string, NotebookRunState> = {};
  for (const [id, run] of runs.entries()) {
    runsObj[id] = run;
  }
  return {
    bridge: { ...bridgeInfo },
    runtimes: Array.from(runtimes.values()),
    runs: runsObj,
    telemetryHistory: historyObj,
    logs: [...logs],
  };
}

function buildCliFlags(accelerator: AcceleratorType): string[] {
  if (accelerator === 'CPU') return [];
  if (accelerator === 'TPU_V5E1') return ['--tpu', 'V5E1'];
  if (accelerator === 'TPU_V6E1') return ['--tpu', 'V6E1'];
  return ['--gpu', accelerator];
}

function buildCliCommandPreview(
  subcommand: string,
  sessionName: string,
  accelerator?: AcceleratorType
): string {
  if (subcommand === 'new' && accelerator) {
    const flags = buildCliFlags(accelerator).join(' ');
    return flags ? `colab new -s ${sessionName} ${flags}` : `colab new -s ${sessionName}`;
  }
  if (subcommand === 'stop') {
    return `colab stop -s ${sessionName}`;
  }
  if (subcommand === 'exec') {
    return `colab exec -s ${sessionName}`;
  }
  return `colab ${subcommand}`;
}

function detectAcceleratorFromLine(line: string): AcceleratorType {
  if (/H100/i.test(line)) return 'H100';
  if (/A100/i.test(line)) return 'A100';
  if (/\bL4\b/i.test(line)) return 'L4';
  if (/\bT4\b/i.test(line)) return 'T4';
  if (/v6e/i.test(line)) return 'TPU_V6E1';
  if (/v5e/i.test(line)) return 'TPU_V5E1';
  return 'CPU';
}

function extractCliError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
    const stdout = typeof e.stdout === 'string' ? e.stdout.trim() : '';
    const raw = stderr || stdout || (typeof e.message === 'string' ? e.message : '');
    if (raw) {
      const cleanedLines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('Command failed:'));
      if (cleanedLines.length > 0) {
        return cleanedLines.slice(-3).join(' ').slice(0, 400);
      }
      return raw.slice(0, 400);
    }
  }
  return fallback;
}

async function provisionColabRuntime(
  rawName: string,
  acc: AcceleratorType
): Promise<RuntimeSession> {
  const specs = ACCELERATOR_SPECS[acc];
  const cmdPreview = buildCliCommandPreview('new', rawName, acc);
  bridgeInfo.lastCommand = cmdPreview;

  const id = `cli-${rawName}`;
  const session: RuntimeSession = {
    id,
    name: rawName,
    accelerator: acc,
    mode: 'cli',
    status: 'provisioning',
    startedAt: new Date().toISOString(),
    activeNotebookId: null,
    activeNotebookName: null,
    specs,
    latestTelemetry: null,
  };

  runtimes.set(id, session);
  telemetryHistory.set(id, []);
  broadcastEvent('runtime', session);
  broadcastEvent('bridge', { ...bridgeInfo });
  appendLog('cli', `$ ${cmdPreview}`, { runtimeId: id, runtimeName: rawName });

  const args = ['new', '-s', rawName, ...buildCliFlags(acc)];
  try {
    const { stdout, stderr } = await execColabCli(args, 90000);
    if (stdout.trim()) {
      appendLog('stdout', stdout.trim(), { runtimeId: id, runtimeName: rawName });
    }
    if (stderr.trim()) {
      appendLog('warning', stderr.trim(), { runtimeId: id, runtimeName: rawName });
    }
    session.status = 'ready';
    broadcastEvent('runtime', session);
    appendLog('info', `Runtime "${rawName}" (${specs.label}) is ready.`, {
      runtimeId: id,
      runtimeName: rawName,
    });
    pollRealTelemetryForSession(session).catch(() => {});
    return session;
  } catch (err) {
    runtimes.delete(id);
    telemetryHistory.delete(id);
    session.status = 'stopped';
    broadcastEvent('runtime', session);
    const msg = extractCliError(err, 'Failed to provision runtime via colab CLI.');
    appendLog('error', msg, { runtimeId: id, runtimeName: rawName });
    throw new Error(msg);
  }
}

async function syncRealColabSessions(): Promise<RuntimeSession[]> {
  if (bridgeInfo.mode !== 'cli') {
    return Array.from(runtimes.values());
  }

  bridgeInfo.lastCommand = 'colab sessions';
  broadcastEvent('bridge', { ...bridgeInfo });

  try {
    const { stdout } = await execColabCli(['sessions'], 15000);
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const discoveredNames = new Set<string>();
    for (const line of lines) {
      // Real `colab sessions` lines have the exact format:
      // "[name] endpoint | Hardware: X | Shape: Y | Variant: Z"
      // Status lines like "[colab] No active sessions found on server." do not include "| Hardware:"
      const sessionMatch = line.match(/^\[([^\]]+)\]\s+(\S+)\s+\|\s+Hardware:\s+/i);
      if (!sessionMatch) continue;
      const name = sessionMatch[1].trim();
      if (!name || name === '?' || !SESSION_NAME_REGEX.test(name)) continue;

      discoveredNames.add(name);
      const existing = Array.from(runtimes.values()).find((r) => r.name === name);
      if (!existing) {
        const acc = detectAcceleratorFromLine(line);
        const id = `cli-${name}`;
        const session: RuntimeSession = {
          id,
          name,
          accelerator: acc,
          mode: 'cli',
          status: 'ready',
          startedAt: new Date().toISOString(),
          activeNotebookId: null,
          activeNotebookName: null,
          specs: ACCELERATOR_SPECS[acc],
          latestTelemetry: null,
        };
        runtimes.set(id, session);
        telemetryHistory.set(id, []);
        broadcastEvent('runtime', session);
      } else if (existing.status === 'stopped') {
        existing.status = 'ready';
        broadcastEvent('runtime', existing);
      }
    }

    // Mark sessions no longer present in `colab sessions` as stopped
    for (const rt of runtimes.values()) {
      if (rt.status !== 'stopped' && rt.status !== 'provisioning' && !discoveredNames.has(rt.name)) {
        rt.status = 'stopped';
        rt.activeNotebookId = null;
        rt.activeNotebookName = null;
        broadcastEvent('runtime', rt);
      }
    }
  } catch (err) {
    const msg = extractCliError(err, 'Failed to list sessions via colab CLI.');
    appendLog('warning', msg);
  }

  return Array.from(runtimes.values());
}

let cliInstallPromise: Promise<boolean> | null = null;

function getUvReleaseTriple(): string | null {
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return 'x86_64-unknown-linux-gnu';
    if (process.arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  } else if (process.platform === 'darwin') {
    if (process.arch === 'arm64') return 'aarch64-apple-darwin';
    if (process.arch === 'x64') return 'x86_64-apple-darwin';
  }
  return null;
}

async function ensureUvBinary(): Promise<string> {
  const { toolsDir, uvBin } = getColabPaths();
  const candidates = [
    uvBin,
    path.join(os.homedir(), '.local', 'bin', 'uv'),
    'uv',
  ];
  for (const candidate of candidates) {
    if (candidate !== 'uv' && !fs.existsSync(candidate)) continue;
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 4000 });
      return candidate;
    } catch {
      // try next candidate
    }
  }

  const triple = getUvReleaseTriple();
  if (!triple) {
    throw new Error(`Unsupported platform/arch for uv auto-install (${process.platform}/${process.arch}).`);
  }

  fs.mkdirSync(toolsDir, { recursive: true, mode: 0o755 });
  const downloadUrl = `https://github.com/astral-sh/uv/releases/latest/download/uv-${triple}.tar.gz`;
  const archivePath = path.join(os.tmpdir(), `uv-${crypto.randomBytes(8).toString('hex')}.tar.gz`);

  try {
    const res = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(45000),
      headers: { 'User-Agent': 'ColabControl-Server' },
    });
    if (!res.ok) {
      throw new Error(`Failed to download uv (HTTP ${res.status}).`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 80 * 1024 * 1024) {
      throw new Error('Unexpected uv archive size.');
    }
    fs.writeFileSync(archivePath, buf, { mode: 0o600 });
    await execFileAsync('tar', ['-xzf', archivePath, '-C', toolsDir, '--strip-components=1'], {
      timeout: 30000,
    });
    fs.chmodSync(uvBin, 0o755);
    await execFileAsync(uvBin, ['--version'], { timeout: 4000 });
    return uvBin;
  } finally {
    removeFileSafe(archivePath);
  }
}

async function installOrRepairColabCli(): Promise<boolean> {
  if (cliInstallPromise) return cliInstallPromise;

  cliInstallPromise = (async () => {
    bridgeInfo.mode = 'cli_installing';
    bridgeInfo.cliInstalled = false;
    bridgeInfo.checkedAt = new Date().toISOString();
    broadcastEvent('bridge', { ...bridgeInfo });
    appendLog('info', 'Auto-installing google-colab-cli (Python 3.12)...');

    try {
      const { root, venvDir, venvPython, pythonInstallDir, uvCacheDir } = getColabPaths();
      fs.mkdirSync(pythonInstallDir, { recursive: true, mode: 0o755 });
      fs.mkdirSync(uvCacheDir, { recursive: true, mode: 0o755 });

      const uvBin = await ensureUvBinary();
      const uvEnv: NodeJS.ProcessEnv = {
        ...process.env,
        UV_PYTHON_INSTALL_DIR: pythonInstallDir,
        UV_CACHE_DIR: uvCacheDir,
      };

      await execFileAsync(uvBin, ['python', 'install', '3.12'], {
        cwd: root,
        env: uvEnv,
        timeout: 120000,
      });
      await execFileAsync(uvBin, ['venv', '--clear', '--python', '3.12', venvDir], {
        cwd: root,
        env: uvEnv,
        timeout: 45000,
      });
      await execFileAsync(
        uvBin,
        ['pip', 'install', '--python', venvPython, 'google-colab-cli'],
        {
          cwd: root,
          env: uvEnv,
          timeout: 120000,
        }
      );
      return true;
    } catch (err) {
      const msg = extractCliError(err, 'Failed to auto-install google-colab-cli.');
      appendLog('error', `Auto-install failed: ${msg}`);
      return false;
    } finally {
      cliInstallPromise = null;
    }
  })();

  return cliInstallPromise;
}

async function probeColabCli(autoInstall = true): Promise<BridgeInfo> {
  bridgeInfo.checkedAt = new Date().toISOString();
  let bin = resolveColabBin();
  const readVersion = async () =>
    execFileAsync(bin, ['version'], {
      timeout: 5000,
    });

  try {
    let verOut: string;
    try {
      ({ stdout: verOut } = await readVersion());
    } catch {
      if (!autoInstall) {
        bridgeInfo.cliInstalled = false;
        bridgeInfo.cliVersion = null;
        bridgeInfo.authAccount = null;
        bridgeInfo.mode = cliInstallPromise ? 'cli_installing' : 'cli_missing';
        return { ...bridgeInfo };
      }
      const installed = await installOrRepairColabCli();
      if (!installed) throw new Error('colab cli unavailable');
      bin = resolveColabBin();
      ({ stdout: verOut } = await readVersion());
    }

    const cleanedVersion = verOut.trim().replace(/^Version:\s*/i, '') || 'installed';
    bridgeInfo.cliInstalled = true;
    bridgeInfo.cliVersion = cleanedVersion;

    if (cliCredentialsJson) {
      bridgeInfo.mode = 'cli';
      await syncRealColabSessions();
      return { ...bridgeInfo };
    }

    // Check if host already has valid ADC credentials configured
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        await execFileAsync(bin, ['--auth=adc', 'sessions'], { timeout: 8000 });
        bridgeInfo.mode = 'cli';
        bridgeInfo.authAccount = bridgeInfo.authAccount || 'ADC Authenticated';
        await syncRealColabSessions();
        return { ...bridgeInfo };
      } catch {
        // fall through to unauthenticated
      }
    }

    bridgeInfo.mode = 'cli_unauthenticated';
    bridgeInfo.authAccount = null;
  } catch {
    bridgeInfo.cliInstalled = false;
    bridgeInfo.cliVersion = null;
    bridgeInfo.authAccount = null;
    bridgeInfo.mode = 'cli_missing';
  }
  return { ...bridgeInfo };
}

async function pollRealTelemetryForSession(session: RuntimeSession): Promise<void> {
  if (bridgeInfo.mode !== 'cli' || session.status === 'stopped' || session.status === 'provisioning') {
    return;
  }
  return new Promise((resolve) => {
    const { child } = spawnColabCli(['exec', '-s', session.name, '--timeout', '10']);
    let out = '';
    const killTimer = setTimeout(() => {
      child.kill('SIGTERM');
    }, 8000);

    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });

    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (code === 0 && out.trim()) {
        const lines = out.trim().split(/\r?\n/);
        const lastLine = lines[lines.length - 1];
        try {
          const parsed = JSON.parse(lastLine) as Partial<TelemetryPoint>;
          if (typeof parsed.cpuPercent === 'number' && typeof parsed.ramUsedGb === 'number') {
            const point: TelemetryPoint = {
              timestamp: new Date().toISOString(),
              cpuPercent: parsed.cpuPercent,
              ramUsedGb: parsed.ramUsedGb,
              ramTotalGb: parsed.ramTotalGb ?? session.specs.ramGb,
              gpuPercent: parsed.gpuPercent ?? 0,
              vramUsedGb: parsed.vramUsedGb ?? 0,
              vramTotalGb: parsed.vramTotalGb ?? session.specs.vramGb,
              diskUsedGb: parsed.diskUsedGb ?? 0,
              diskTotalGb: parsed.diskTotalGb ?? session.specs.diskGb,
            };
            session.latestTelemetry = point;
            const hist = telemetryHistory.get(session.id) ?? [];
            hist.push(point);
            if (hist.length > MAX_HISTORY_POINTS) {
              hist.splice(0, hist.length - MAX_HISTORY_POINTS);
            }
            telemetryHistory.set(session.id, hist);
            broadcastEvent('telemetry', { runtimeId: session.id, point });
          }
        } catch {
          // ignore non-JSON probe output
        }
      }
      resolve();
    });

    child.on('error', () => {
      clearTimeout(killTimer);
      resolve();
    });

    child.stdin.write(TELEMETRY_PROBE_PY);
    child.stdin.end();
  });
}

// Real telemetry polling loop — runs ONLY when live google-colab-cli runtimes exist
setInterval(async () => {
  if (bridgeInfo.mode !== 'cli' || pollingTelemetry) return;
  const activeSessions = Array.from(runtimes.values()).filter(
    (r) => r.status === 'ready' || r.status === 'busy'
  );
  if (activeSessions.length === 0) return;

  pollingTelemetry = true;
  try {
    for (const session of activeSessions) {
      await pollRealTelemetryForSession(session);
    }
  } finally {
    pollingTelemetry = false;
  }
}, 5000);

function validateEnvMap(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Environment variables must be a key-value object.');
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_ENV_VARS) {
    throw new Error(`Maximum of ${MAX_ENV_VARS} environment variables allowed per notebook.`);
  }
  const validated: Record<string, string> = {};
  for (const [key, val] of entries) {
    if (!ENV_KEY_REGEX.test(key)) {
      throw new Error(`Invalid environment variable name: "${key}".`);
    }
    if (typeof val !== 'string') {
      throw new Error(`Environment variable "${key}" must have a string value.`);
    }
    if (val.length > MAX_ENV_VAL_LENGTH) {
      throw new Error(`Environment variable "${key}" exceeds maximum length.`);
    }
    validated[key] = val;
  }
  return validated;
}

function validateAndParseGitHubUrl(rawUrl: string):
  | {
      kind: 'raw_file';
      rawUrl: string;
      blobUrl: string;
      fileName: string;
      repoLabel: string;
    }
  | {
      kind: 'repo';
      owner: string;
      repo: string;
      branch: string | null;
      subpath: string;
      repoLabel: string;
    } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Enter a valid HTTPS GitHub URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS GitHub URLs are supported.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Credentials in URL are not allowed.');
  }
  if (!ALLOWED_GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('URL must point to github.com or raw.githubusercontent.com.');
  }

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);
  const GH_IDENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

  const assertOwnerRepo = (o: string, r: string) => {
    if (!GH_IDENT.test(o) || !GH_IDENT.test(r) || o === '..' || r === '..') {
      throw new Error('Invalid GitHub repository owner or name.');
    }
  };

  if (host === 'raw.githubusercontent.com') {
    if (segments.length < 4) {
      throw new Error('Raw GitHub URL must point to a .ipynb file.');
    }
    const [owner, repo, branch, ...rest] = segments;
    assertOwnerRepo(owner, repo);
    const filePath = rest.join('/');
    if (!filePath.toLowerCase().endsWith('.ipynb')) {
      throw new Error('Only .ipynb notebook files can be imported.');
    }
    const fileName = rest[rest.length - 1];
    return {
      kind: 'raw_file',
      rawUrl: `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${rest.map(encodeURIComponent).join('/')}`,
      blobUrl: `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`,
      fileName: decodeURIComponent(fileName),
      repoLabel: `${owner}/${repo}`,
    };
  }

  if (segments.length < 2) {
    throw new Error('GitHub URL must include owner and repository name.');
  }
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');
  assertOwnerRepo(owner, repo);

  if (segments.length >= 5 && segments[2] === 'blob') {
    const branch = segments[3];
    const rest = segments.slice(4);
    const filePath = rest.join('/');
    if (!filePath.toLowerCase().endsWith('.ipynb')) {
      throw new Error('Target GitHub file must have a .ipynb extension.');
    }
    return {
      kind: 'raw_file',
      rawUrl: `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${rest.map(encodeURIComponent).join('/')}`,
      blobUrl: `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`,
      fileName: decodeURIComponent(rest[rest.length - 1]),
      repoLabel: `${owner}/${repo}`,
    };
  }

  if (segments.length >= 4 && segments[2] === 'tree') {
    const branch = segments[3];
    const subpath = segments.slice(4).join('/');
    return {
      kind: 'repo',
      owner,
      repo,
      branch,
      subpath,
      repoLabel: `${owner}/${repo}`,
    };
  }

  return {
    kind: 'repo',
    owner,
    repo,
    branch: null,
    subpath: '',
    repoLabel: `${owner}/${repo}`,
  };
}

async function fetchValidatedNotebookFromRawUrl(rawUrl: string): Promise<{
  rawJson: string;
  cellCount: number;
  codeCells: string[];
  sizeBytes: number;
}> {
  const parsed = validateAndParseGitHubUrl(rawUrl);
  if (parsed.kind !== 'raw_file') {
    throw new Error('Expected a direct .ipynb GitHub URL.');
  }

  const response = await fetch(parsed.rawUrl, {
    headers: {
      'User-Agent': 'ColabControl-Dashboard',
      Accept: 'application/json, text/plain',
    },
    redirect: 'error',
  });

  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status} while fetching notebook.`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > MAX_NOTEBOOK_BYTES) {
    throw new Error('Notebook exceeds the 10 MB import limit.');
  }

  const rawText = await response.text();
  const sizeBytes = Buffer.byteLength(rawText, 'utf8');
  if (sizeBytes > MAX_NOTEBOOK_BYTES) {
    throw new Error('Notebook exceeds the 10 MB import limit.');
  }

  let nb: { cells?: Array<{ cell_type?: string; source?: string | string[] }>; nbformat?: number };
  try {
    nb = JSON.parse(rawText);
  } catch {
    throw new Error('Fetched file is not valid .ipynb JSON.');
  }

  if (!nb || !Array.isArray(nb.cells)) {
    throw new Error('Invalid notebook format: missing cells array.');
  }

  const codeCells: string[] = [];
  for (const cell of nb.cells) {
    if (cell.cell_type === 'code') {
      const src = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
      if (src.trim()) {
        codeCells.push(src);
      }
    }
  }

  return {
    rawJson: rawText,
    cellCount: nb.cells.length,
    codeCells,
    sizeBytes,
  };
}

async function startServer(): Promise<void> {
  await probeColabCli(false);

  if (bridgeInfo.mode === 'cli') {
    appendLog('info', `Connected to google-colab-cli (${bridgeInfo.cliVersion}).`);
  } else if (bridgeInfo.mode === 'cli_unauthenticated') {
    appendLog(
      'info',
      `google-colab-cli v${bridgeInfo.cliVersion ?? ''} detected. Click Connect Colab CLI on Runtimes to sign in.`
    );
  } else {
    bridgeInfo.mode = 'cli_installing';
    // Non-blocking background install so Express binds port 3000 immediately
    probeColabCli(true)
      .then((info) => {
        broadcastEvent('bridge', info);
        if (info.mode === 'cli') {
          appendLog('info', `Connected to google-colab-cli (${info.cliVersion}).`);
        } else if (info.mode === 'cli_unauthenticated') {
          appendLog(
            'info',
            `google-colab-cli v${info.cliVersion ?? ''} installed. Click Connect Colab CLI on Runtimes to sign in.`
          );
        }
      })
      .catch(() => {
        // errors already logged inside installOrRepairColabCli
      });
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '12mb' }));

  // In-memory Drive session store backed by HttpOnly; Secure; SameSite=None; Partitioned cookie
  interface DriveSessionRecord {
    accessToken: string;
    email: string | null;
    expiresAt: number;
  }

  const DRIVE_COOKIE_NAME = 'colabcontrol_sid';
  const DRIVE_FILE_ID_REGEX = /^[a-zA-Z0-9_-]{5,128}$/;
  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  const driveSessions = new Map<string, DriveSessionRecord>();

  function parseCookies(req: Request): Record<string, string> {
    const header = req.headers.cookie;
    if (!header) return {};
    const out: Record<string, string> = {};
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const key = part.slice(0, eq).trim();
      const val = part.slice(eq + 1).trim();
      out[key] = decodeURIComponent(val);
    }
    return out;
  }

  function setSessionCookie(res: Response, sid: string, maxAgeSec: number): void {
    res.setHeader(
      'Set-Cookie',
      `${DRIVE_COOKIE_NAME}=${encodeURIComponent(sid)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${maxAgeSec}`
    );
  }

  function clearSessionCookie(res: Response): void {
    res.setHeader(
      'Set-Cookie',
      `${DRIVE_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0`
    );
  }

  function verifySameOriginOrHeader(req: Request): boolean {
    if (req.headers['x-requested-with'] === 'ColabControl') {
      return true;
    }
    const origin = req.headers.origin;
    const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
    if (origin && host) {
      try {
        return new URL(origin).host === host.split(',')[0].trim();
      } catch {
        return false;
      }
    }
    return false;
  }

  function resolveDriveToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) return token;
    }
    const cookies = parseCookies(req);
    const sid = cookies[DRIVE_COOKIE_NAME];
    if (!sid) return null;
    const record = driveSessions.get(sid);
    if (!record) return null;
    if (Date.now() >= record.expiresAt) {
      driveSessions.delete(sid);
      return null;
    }
    return record.accessToken;
  }

  async function parseGoogleDriveError(response: globalThis.Response): Promise<string> {
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) return body.error.message;
    } catch {
      // ignore
    }
    return `Google Drive API returned HTTP ${response.status}`;
  }

  // Establish persistent HttpOnly session for Google Drive token (verified with Google tokeninfo)
  app.post('/api/auth/session', async (req: Request, res: Response) => {
    if (!verifySameOriginOrHeader(req)) {
      res.status(403).json({ error: 'Forbidden request origin.' });
      return;
    }

    const accessToken =
      typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!accessToken) {
      res.status(400).json({ error: 'Access token is required.' });
      return;
    }

    try {
      const infoRes = await fetch('https://oauth2.googleapis.com/tokeninfo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: accessToken }).toString(),
      });
      if (!infoRes.ok) {
        res.status(401).json({ error: 'Invalid or expired Google access token.' });
        return;
      }
      const info = (await infoRes.json()) as { expires_in?: string; email?: string };
      const expiresIn = Math.max(60, Math.min(3600, Number(info.expires_in ?? '3500') || 3500));

      // Rotate any previous session cookie for this browser
      const prevSid = parseCookies(req)[DRIVE_COOKIE_NAME];
      if (prevSid) driveSessions.delete(prevSid);

      const sid = crypto.randomBytes(32).toString('hex');
      driveSessions.set(sid, {
        accessToken,
        email: info.email ?? null,
        expiresAt: Date.now() + expiresIn * 1000,
      });

      setSessionCookie(res, sid, expiresIn);
      res.json({ ok: true, email: info.email ?? null, expiresIn });
    } catch {
      res.status(502).json({ error: 'Unable to verify Google access token.' });
    }
  });

  app.get('/api/auth/session', (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    const sid = cookies[DRIVE_COOKIE_NAME];
    if (!sid) {
      res.json({ active: false });
      return;
    }
    const record = driveSessions.get(sid);
    if (!record || Date.now() >= record.expiresAt) {
      if (record) driveSessions.delete(sid);
      clearSessionCookie(res);
      res.json({ active: false });
      return;
    }
    res.json({
      active: true,
      email: record.email,
      expiresAt: new Date(record.expiresAt).toISOString(),
    });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    if (!verifySameOriginOrHeader(req)) {
      res.status(403).json({ error: 'Forbidden request origin.' });
      return;
    }
    const sid = parseCookies(req)[DRIVE_COOKIE_NAME];
    if (sid) driveSessions.delete(sid);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Google Drive Proxy Endpoints (uses in-memory Bearer token OR HttpOnly session cookie)
  app.get('/api/drive/notebooks', async (req: Request, res: Response) => {
    const token = resolveDriveToken(req);
    if (!token) {
      res.status(401).json({ code: 'DRIVE_TOKEN_EXPIRED', error: 'Google Drive session expired.' });
      return;
    }

    const query = encodeURIComponent(
      "(name contains '.ipynb' or mimeType = 'application/vnd.google.colaboratory') and trashed = false"
    );
    const fields = encodeURIComponent('files(id,name,modifiedTime,size,webViewLink,mimeType)');
    const driveRes = await fetch(
      `${DRIVE_API}/files?q=${query}&orderBy=modifiedTime%20desc&pageSize=100&fields=${fields}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (driveRes.status === 401) {
      const sid = parseCookies(req)[DRIVE_COOKIE_NAME];
      if (sid) driveSessions.delete(sid);
      clearSessionCookie(res);
      res.status(401).json({ code: 'DRIVE_TOKEN_EXPIRED', error: 'Google Drive token expired.' });
      return;
    }
    if (!driveRes.ok) {
      res.status(driveRes.status).json({ error: await parseGoogleDriveError(driveRes) });
      return;
    }

    const data = (await driveRes.json()) as {
      files?: Array<{
        id: string;
        name: string;
        modifiedTime?: string;
        size?: string;
      }>;
    };

    res.json({
      files: (data.files ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        source: 'drive',
        modifiedTime: f.modifiedTime || new Date().toISOString(),
        sizeBytes: Number(f.size ?? 0),
        webViewLink: `https://colab.research.google.com/drive/${encodeURIComponent(f.id)}`,
      })),
    });
  });

  app.get('/api/drive/notebooks/:id/cells', async (req: Request, res: Response) => {
    const token = resolveDriveToken(req);
    if (!token) {
      res.status(401).json({ code: 'DRIVE_TOKEN_EXPIRED', error: 'Google Drive session expired.' });
      return;
    }
    const fileId = req.params.id;
    if (!DRIVE_FILE_ID_REGEX.test(fileId)) {
      res.status(400).json({ error: 'Invalid Drive file ID.' });
      return;
    }

    const driveRes = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (driveRes.status === 401) {
      res.status(401).json({ code: 'DRIVE_TOKEN_EXPIRED', error: 'Google Drive token expired.' });
      return;
    }
    if (!driveRes.ok) {
      res.status(driveRes.status).json({ error: await parseGoogleDriveError(driveRes) });
      return;
    }

    try {
      const text = await driveRes.text();
      const parsed = JSON.parse(text) as {
        cells?: Array<{ cell_type?: string; source?: string | string[] }>;
      };
      const cells = Array.isArray(parsed?.cells) ? parsed.cells : [];
      const codeCells: string[] = [];
      for (const cell of cells) {
        if (cell.cell_type === 'code') {
          const src = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
          if (src.trim()) codeCells.push(src);
        }
      }
      res.json({ cellCount: cells.length, codeCells });
    } catch {
      res.status(400).json({ error: 'Unable to parse notebook JSON from Google Drive.' });
    }
  });

  app.get('/api/drive/notebooks/check', async (req: Request, res: Response) => {
    const token = resolveDriveToken(req);
    if (!token) {
      res.status(401).json({ code: 'DRIVE_TOKEN_EXPIRED', error: 'Google Drive session expired.' });
      return;
    }
    const fileName = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!fileName) {
      res.status(400).json({ error: 'File name is required.' });
      return;
    }

    const escaped = fileName.replace(/'/g, "\\'");
    const q = encodeURIComponent(`name = '${escaped}' and trashed = false`);
    const driveRes = await fetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)&pageSize=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (driveRes.status === 401) {
      res.status(401).json({ code: 'DRIVE_TOKEN_EXPIRED', error: 'Google Drive token expired.' });
      return;
    }
    if (!driveRes.ok) {
      res.json({ existing: null });
      return;
    }
    const data = (await driveRes.json()) as { files?: Array<{ id: string; name: string }> };
    res.json({ existing: data.files?.[0] ?? null });
  });

  app.post('/api/drive/notebooks/save', async (req: Request, res: Response) => {
    if (!verifySameOriginOrHeader(req)) {
      res.status(403).json({ error: 'Forbidden request origin.' });
      return;
    }
    const token = resolveDriveToken(req);
    if (!token) {
      res.status(401).json({ code: 'DRIVE_TOKEN_EXPIRED', error: 'Google Drive session expired.' });
      return;
    }

    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : '';
    const rawJson = typeof req.body?.rawJson === 'string' ? req.body.rawJson : '';
    const overwriteFileId =
      typeof req.body?.overwriteFileId === 'string' ? req.body.overwriteFileId.trim() : undefined;

    if (!fileName || !rawJson) {
      res.status(400).json({ error: 'fileName and rawJson are required.' });
      return;
    }
    if (overwriteFileId && !DRIVE_FILE_ID_REGEX.test(overwriteFileId)) {
      res.status(400).json({ error: 'Invalid overwriteFileId.' });
      return;
    }

    const safeName = fileName.endsWith('.ipynb') ? fileName : `${fileName}.ipynb`;

    if (overwriteFileId) {
      const updateRes = await fetch(
        `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(overwriteFileId)}?uploadType=media&fields=id,name,modifiedTime,size`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-ipynb+json',
          },
          body: rawJson,
        }
      );
      if (!updateRes.ok) {
        res.status(updateRes.status).json({ error: await parseGoogleDriveError(updateRes) });
        return;
      }
      const updated = (await updateRes.json()) as {
        id: string;
        name: string;
        modifiedTime?: string;
        size?: string;
      };
      res.json({
        id: updated.id,
        name: updated.name,
        source: 'drive',
        modifiedTime: updated.modifiedTime || new Date().toISOString(),
        sizeBytes: Number(updated.size ?? Buffer.byteLength(rawJson, 'utf8')),
        webViewLink: `https://colab.research.google.com/drive/${encodeURIComponent(updated.id)}`,
      });
      return;
    }

    // Find or create "Colab Notebooks" folder
    let folderId: string | null = null;
    const folderQuery = encodeURIComponent(
      "name = 'Colab Notebooks' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    );
    const searchRes = await fetch(
      `${DRIVE_API}/files?q=${folderQuery}&fields=files(id)&pageSize=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (searchRes.ok) {
      const found = (await searchRes.json()) as { files?: Array<{ id: string }> };
      folderId = found.files?.[0]?.id ?? null;
    }
    if (!folderId) {
      const createFolderRes = await fetch(`${DRIVE_API}/files?fields=id`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Colab Notebooks',
          mimeType: 'application/vnd.google-apps.folder',
        }),
      });
      if (!createFolderRes.ok) {
        res
          .status(createFolderRes.status)
          .json({ error: await parseGoogleDriveError(createFolderRes) });
        return;
      }
      const createdFolder = (await createFolderRes.json()) as { id: string };
      folderId = createdFolder.id;
    }

    const boundary = `colabcontrol_${crypto.randomBytes(8).toString('hex')}`;
    const metadata = {
      name: safeName,
      mimeType: 'application/x-ipynb+json',
      parents: [folderId],
    };
    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/x-ipynb+json',
      '',
      rawJson,
      `--${boundary}--`,
    ].join('\r\n');

    const uploadRes = await fetch(
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime,size`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );
    if (!uploadRes.ok) {
      res.status(uploadRes.status).json({ error: await parseGoogleDriveError(uploadRes) });
      return;
    }
    const created = (await uploadRes.json()) as {
      id: string;
      name: string;
      modifiedTime?: string;
      size?: string;
    };
    res.json({
      id: created.id,
      name: created.name,
      source: 'drive',
      modifiedTime: created.modifiedTime || new Date().toISOString(),
      sizeBytes: Number(created.size ?? Buffer.byteLength(rawJson, 'utf8')),
      webViewLink: `https://colab.research.google.com/drive/${encodeURIComponent(created.id)}`,
    });
  });

  app.delete('/api/drive/notebooks/:id', async (req: Request, res: Response) => {
    if (!verifySameOriginOrHeader(req)) {
      res.status(403).json({ error: 'Forbidden request origin.' });
      return;
    }
    const token = resolveDriveToken(req);
    if (!token) {
      res.status(401).json({ code: 'DRIVE_TOKEN_EXPIRED', error: 'Google Drive session expired.' });
      return;
    }
    const fileId = req.params.id;
    if (!DRIVE_FILE_ID_REGEX.test(fileId)) {
      res.status(400).json({ error: 'Invalid Drive file ID.' });
      return;
    }

    const driveRes = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (driveRes.status === 401) {
      res.status(401).json({ code: 'DRIVE_TOKEN_EXPIRED', error: 'Google Drive token expired.' });
      return;
    }
    if (!driveRes.ok && driveRes.status !== 204) {
      res.status(driveRes.status).json({ error: await parseGoogleDriveError(driveRes) });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/colab/state', (_req: Request, res: Response) => {
    res.json(getFullState());
  });

  app.post('/api/colab/probe', async (_req: Request, res: Response) => {
    const info = await probeColabCli(true);
    broadcastEvent('bridge', info);
    res.json(info);
  });

  // In-app Google Colab CLI OAuth2 Flow (uses official google-colab-cli bundled oauth_config.json)
  app.post('/api/colab/auth/start', async (req: Request, res: Response) => {
    if (!verifySameOriginOrHeader(req)) {
      res.status(403).json({ error: 'Forbidden request origin.' });
      return;
    }
    if (!bridgeInfo.cliInstalled) {
      const info = await probeColabCli(true);
      broadcastEvent('bridge', info);
      if (!info.cliInstalled) {
        res.status(503).json({ error: 'google-colab-cli could not be installed on this server.' });
        return;
      }
    }

    // Prune stale flows older than 10 minutes
    const now = Date.now();
    for (const [k, v] of pendingCliAuthFlows.entries()) {
      if (now - v.createdAt > 10 * 60 * 1000) pendingCliAuthFlows.delete(k);
    }

    const pyScript = `
import json
from importlib import resources
from google_auth_oauthlib.flow import InstalledAppFlow
from colab_cli.auth import PUBLIC_SCOPES, REMOTE_REDIRECT_URI

cfg = json.loads(resources.files("colab_cli").joinpath("oauth_config.json").read_text())
flow = InstalledAppFlow.from_client_config(cfg, PUBLIC_SCOPES)
flow.redirect_uri = REMOTE_REDIRECT_URI
auth_url, _ = flow.authorization_url(prompt="consent", token_usage="remote")
print(json.dumps({"authUrl": auth_url, "codeVerifier": getattr(flow, "code_verifier", None)}))
`.trim();

    try {
      const { stdout } = await execFileAsync(resolveColabPython(), ['-c', pyScript], {
        timeout: 15000,
      });
      const parsed = JSON.parse(stdout.trim()) as {
        authUrl: string;
        codeVerifier: string | null;
      };
      const flowId = crypto.randomBytes(16).toString('hex');
      pendingCliAuthFlows.set(flowId, {
        codeVerifier: parsed.codeVerifier ?? null,
        createdAt: Date.now(),
      });
      res.json({ flowId, authUrl: parsed.authUrl });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start Colab CLI login.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/colab/auth/complete', async (req: Request, res: Response) => {
    if (!verifySameOriginOrHeader(req)) {
      res.status(403).json({ error: 'Forbidden request origin.' });
      return;
    }

    const flowId = typeof req.body?.flowId === 'string' ? req.body.flowId.trim() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

    if (!flowId || !code) {
      res.status(400).json({ error: 'Authorization code is required.' });
      return;
    }
    if (code.length > 512) {
      res.status(400).json({ error: 'Authorization code is too long.' });
      return;
    }

    const pending = pendingCliAuthFlows.get(flowId);
    if (!pending) {
      res.status(400).json({ error: 'Auth session expired. Click Connect Colab CLI again.' });
      return;
    }
    pendingCliAuthFlows.delete(flowId);

    const pyScript = `
import json, sys
from importlib import resources
from google_auth_oauthlib.flow import InstalledAppFlow
from colab_cli.auth import PUBLIC_SCOPES, REMOTE_REDIRECT_URI

payload = json.loads(sys.stdin.read())
cfg = json.loads(resources.files("colab_cli").joinpath("oauth_config.json").read_text())
flow = InstalledAppFlow.from_client_config(cfg, PUBLIC_SCOPES)
flow.redirect_uri = REMOTE_REDIRECT_URI
if payload.get("codeVerifier"):
    flow.code_verifier = payload["codeVerifier"]
flow.fetch_token(code=payload["code"])
creds = flow.credentials
info = json.loads(creds.to_json())
info["type"] = "authorized_user"
print(json.dumps({"credentials": info, "accessToken": creds.token}))
`.trim();

    try {
      const resultText = await new Promise<string>((resolve, reject) => {
        const child = spawn(resolveColabPython(), ['-c', pyScript], { shell: false });
        let out = '';
        let errOut = '';
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('Timed out exchanging authorization code.'));
        }, 20000);
        child.stdout.on('data', (d: Buffer) => {
          out += d.toString('utf8');
        });
        child.stderr.on('data', (d: Buffer) => {
          errOut += d.toString('utf8');
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('close', (exitCode) => {
          clearTimeout(timer);
          if (exitCode !== 0) {
            reject(new Error('Invalid or expired authorization code. Please try again.'));
          } else {
            resolve(out.trim());
          }
        });
        child.stdin.write(
          JSON.stringify({ code, codeVerifier: pending.codeVerifier })
        );
        child.stdin.end();
      });

      const parsed = JSON.parse(resultText) as {
        credentials: Record<string, unknown>;
        accessToken?: string;
      };

      let accountEmail = 'Authenticated';
      if (parsed.accessToken) {
        try {
          const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${parsed.accessToken}` },
          });
          if (uRes.ok) {
            const uJson = (await uRes.json()) as { email?: string };
            if (uJson.email) accountEmail = uJson.email;
          }
        } catch {
          // keep default account label
        }
      }

      cliCredentialsJson = JSON.stringify(parsed.credentials);
      bridgeInfo.mode = 'cli';
      bridgeInfo.authAccount = accountEmail;
      bridgeInfo.checkedAt = new Date().toISOString();
      broadcastEvent('bridge', { ...bridgeInfo });
      appendLog('info', `Authenticated google-colab-cli as ${accountEmail}.`);

      await syncRealColabSessions();
      res.json({ ok: true, bridge: { ...bridgeInfo } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to complete Colab CLI login.';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/colab/auth/disconnect', (req: Request, res: Response) => {
    if (!verifySameOriginOrHeader(req)) {
      res.status(403).json({ error: 'Forbidden request origin.' });
      return;
    }
    cliCredentialsJson = null;
    bridgeInfo.mode = bridgeInfo.cliInstalled ? 'cli_unauthenticated' : 'cli_missing';
    bridgeInfo.authAccount = null;
    bridgeInfo.checkedAt = new Date().toISOString();
    broadcastEvent('bridge', { ...bridgeInfo });
    appendLog('info', 'Disconnected google-colab-cli session.');
    res.json({ ok: true, bridge: { ...bridgeInfo } });
  });

  app.post('/api/colab/sessions/sync', async (_req: Request, res: Response) => {
    if (bridgeInfo.mode !== 'cli') {
      res.status(503).json({
        error:
          bridgeInfo.mode === 'cli_unauthenticated'
            ? 'google-colab-cli is not connected. Click Connect Colab CLI to sign in.'
            : 'google-colab-cli is not installed on this server.',
      });
      return;
    }
    const list = await syncRealColabSessions();
    res.json({ runtimes: list });
  });

  // Live SSE Stream
  app.get('/api/colab/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    res.write(`event: init\ndata: ${JSON.stringify(getFullState())}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(res);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  // Provision Real Runtime via google-colab-cli (`colab new`)
  app.post('/api/colab/runtimes', async (req: Request, res: Response) => {
    if (bridgeInfo.mode !== 'cli') {
      const msg =
        bridgeInfo.mode === 'cli_unauthenticated'
          ? 'google-colab-cli is not connected. Click Connect Colab CLI to sign in.'
          : 'google-colab-cli is not installed on this server.';
      appendLog('error', msg);
      res.status(503).json({ error: msg });
      return;
    }

    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const accelerator = typeof req.body?.accelerator === 'string' ? req.body.accelerator.trim() : 'T4';

    if (!SESSION_NAME_REGEX.test(rawName)) {
      res.status(400).json({
        error: 'Session name must be 1–40 characters (letters, numbers, hyphens, underscores).',
      });
      return;
    }
    if (!VALID_ACCELERATORS.has(accelerator)) {
      res.status(400).json({ error: 'Unsupported accelerator tier.' });
      return;
    }

    for (const existing of runtimes.values()) {
      if (existing.name.toLowerCase() === rawName.toLowerCase() && existing.status !== 'stopped') {
        res.status(409).json({ error: `Active session "${rawName}" already exists.` });
        return;
      }
    }

    const acc = accelerator as AcceleratorType;
    try {
      const session = await provisionColabRuntime(rawName, acc);
      res.status(201).json(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to provision runtime via colab CLI.';
      res.status(502).json({ error: msg });
    }
  });

  // Terminate Real Runtime via google-colab-cli (`colab stop`)
  app.delete('/api/colab/runtimes/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    const session = runtimes.get(id);
    if (!session) {
      res.status(404).json({ error: 'Runtime not found.' });
      return;
    }

    if (session.activeNotebookId) {
      const handle = activeExecutions.get(session.activeNotebookId);
      handle?.abort();
      activeExecutions.delete(session.activeNotebookId);
      const run = runs.get(session.activeNotebookId);
      if (run && run.status === 'running') {
        run.status = 'idle';
        broadcastEvent('run', run);
      }
    }

    const cmdPreview = buildCliCommandPreview('stop', session.name);
    bridgeInfo.lastCommand = cmdPreview;
    broadcastEvent('bridge', { ...bridgeInfo });
    appendLog('cli', `$ ${cmdPreview}`, { runtimeId: session.id, runtimeName: session.name });

    try {
      await execColabCli(['stop', '-s', session.name], 25000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'colab stop returned an error';
      appendLog('error', msg, { runtimeId: session.id, runtimeName: session.name });
      res.status(502).json({ error: msg });
      return;
    }

    session.status = 'stopped';
    session.activeNotebookId = null;
    session.activeNotebookName = null;
    session.latestTelemetry = null;
    broadcastEvent('runtime', session);
    appendLog('warning', `Runtime "${session.name}" stopped.`, {
      runtimeId: session.id,
      runtimeName: session.name,
    });

    res.json({ ok: true, runtime: session });
  });

  // Start Whole Notebook Execution via google-colab-cli (`colab exec`) with Per-Notebook Env
  app.post('/api/colab/notebooks/start', async (req: Request, res: Response) => {
    if (bridgeInfo.mode !== 'cli') {
      res.status(503).json({
        error:
          bridgeInfo.mode === 'cli_unauthenticated'
            ? 'google-colab-cli is not connected. Click Connect Colab CLI to sign in.'
            : 'google-colab-cli is not installed on this server.',
      });
      return;
    }

    const notebookId = typeof req.body?.notebookId === 'string' ? req.body.notebookId.trim() : '';
    const notebookName = typeof req.body?.notebookName === 'string' ? req.body.notebookName.trim() : '';
    const runtimeId = typeof req.body?.runtimeId === 'string' ? req.body.runtimeId.trim() : '';
    const rawCells: string[] = Array.isArray(req.body?.cells)
      ? req.body.cells.filter((c: unknown): c is string => typeof c === 'string')
      : [];

    if (!notebookId || !notebookName) {
      res.status(400).json({ error: 'notebookId and notebookName are required.' });
      return;
    }

    let envVars: Record<string, string>;
    try {
      envVars = validateEnvMap(req.body?.env);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid env variables.' });
      return;
    }

    if (rawCells.length === 0) {
      res.status(400).json({ error: 'Notebook contains no executable code cells.' });
      return;
    }

    let session: RuntimeSession | undefined;
    if (!runtimeId || runtimeId.startsWith('auto:')) {
      const requestedAcc = runtimeId.startsWith('auto:') ? runtimeId.slice(5) : 'CPU';
      const acc: AcceleratorType = VALID_ACCELERATORS.has(requestedAcc)
        ? (requestedAcc as AcceleratorType)
        : 'CPU';
      const autoName = `colab-${acc.toLowerCase().replace(/[^a-z0-9]/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
      try {
        session = await provisionColabRuntime(autoName, acc);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to provision Colab runtime.';
        res.status(502).json({ error: msg });
        return;
      }
    } else {
      session = runtimes.get(runtimeId);
    }

    if (!session || session.status === 'stopped') {
      res.status(400).json({ error: 'Select an active Colab runtime before starting a notebook.' });
      return;
    }
    if (session.status === 'provisioning') {
      res.status(409).json({ error: `Runtime "${session.name}" is still provisioning.` });
      return;
    }
    if (session.status === 'busy' && session.activeNotebookId !== notebookId) {
      res.status(409).json({
        error: `Runtime "${session.name}" is currently running "${session.activeNotebookName}".`,
      });
      return;
    }

    const cells = rawCells.slice(0, 200);
    const runState: NotebookRunState = {
      notebookId,
      notebookName,
      runtimeId: session.id,
      status: 'running',
      startedAt: new Date().toISOString(),
      currentCell: 1,
      totalCells: cells.length,
    };

    runs.set(notebookId, runState);
    session.status = 'busy';
    session.activeNotebookId = notebookId;
    session.activeNotebookName = notebookName;

    const cmdPreview = buildCliCommandPreview('exec', session.name);
    bridgeInfo.lastCommand = `${cmdPreview} -f ${notebookName}`;

    broadcastEvent('bridge', { ...bridgeInfo });
    broadcastEvent('runtime', session);
    broadcastEvent('run', runState);

    appendLog('cli', `$ ${cmdPreview} -f "${notebookName}" (${cells.length} code cells)`, {
      runtimeId: session.id,
      runtimeName: session.name,
      notebookId,
      notebookName,
    });

    const envKeys = Object.keys(envVars);
    if (envKeys.length > 0) {
      // Log key names ONLY — never log secret env values
      appendLog('info', `Injected ${envKeys.length} env var(s): ${envKeys.join(', ')}`, {
        runtimeId: session.id,
        runtimeName: session.name,
        notebookId,
        notebookName,
      });
    }

    // Write temporary .ipynb so colab exec runs each cell individually on the remote Jupyter kernel
    const tmpNbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colabcontrol-nb-'));
    fs.chmodSync(tmpNbDir, 0o700);
    const tmpNbPath = path.join(tmpNbDir, 'notebook.ipynb');
    const nbPayload = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: {
          display_name: 'Python 3',
          language: 'python',
          name: 'python3',
        },
        language_info: {
          name: 'python',
        },
      },
      cells: cells.map((source, idx) => ({
        cell_type: 'code',
        id: `cell-${idx + 1}`,
        execution_count: null,
        metadata: {},
        outputs: [],
        source,
      })),
    };
    fs.writeFileSync(tmpNbPath, JSON.stringify(nbPayload), { mode: 0o600 });

    const cleanupTmpNbDir = () => {
      try {
        fs.rmSync(tmpNbDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    };

    const execArgs = ['exec', '-s', session.name, '-f', tmpNbPath, '--timeout', '0'];
    for (const k of envKeys) {
      execArgs.push('--env', `${k}=${envVars[k]}`);
    }

    let aborted = false;
    let sessionLost = false;
    const { child } = spawnColabCli(execArgs);
    const activeSession = session;

    activeExecutions.set(notebookId, {
      abort: () => {
        aborted = true;
        child.kill('SIGTERM');
      },
    });

    child.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (line.includes('Saving notebook with outputs to') || line.includes("Parsing notebook '")) {
          continue;
        }
        if (
          (line.includes("[colab] Session '") && line.includes('not found.')) ||
          line.includes('appears to be lost')
        ) {
          sessionLost = true;
        }
        const cellMatch = line.match(/\[colab\] Executing cell (\d+)\/(\d+)/);
        if (cellMatch) {
          runState.currentCell = Number(cellMatch[1]);
          broadcastEvent('run', runState);
        }
        appendLog('stdout', line, {
          runtimeId: activeSession.id,
          runtimeName: activeSession.name,
          notebookId,
          notebookName,
        });
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        appendLog('error', line, {
          runtimeId: activeSession.id,
          runtimeName: activeSession.name,
          notebookId,
          notebookName,
        });
      }
    });

    child.on('error', (err) => {
      cleanupTmpNbDir();
      activeExecutions.delete(notebookId);
      runState.status = 'error';
      if (activeSession.activeNotebookId === notebookId) {
        activeSession.activeNotebookId = null;
        activeSession.activeNotebookName = null;
        if (activeSession.status !== 'stopped') activeSession.status = 'ready';
        broadcastEvent('runtime', activeSession);
      }
      broadcastEvent('run', runState);
      appendLog('error', err.message, {
        runtimeId: activeSession.id,
        runtimeName: activeSession.name,
        notebookId,
        notebookName,
      });
    });

    child.on('close', (code) => {
      cleanupTmpNbDir();
      activeExecutions.delete(notebookId);
      if (activeSession.activeNotebookId === notebookId) {
        activeSession.activeNotebookId = null;
        activeSession.activeNotebookName = null;
        if (sessionLost) {
          activeSession.status = 'stopped';
        } else if (activeSession.status !== 'stopped') {
          activeSession.status = 'ready';
        }
        broadcastEvent('runtime', activeSession);
      }
      if (aborted) return;
      runState.status = code === 0 ? 'completed' : 'error';
      runState.currentCell = cells.length;
      broadcastEvent('run', runState);
      appendLog(
        code === 0 ? 'info' : 'error',
        code === 0
          ? `Finished "${notebookName}" (exit code 0).`
          : `Notebook "${notebookName}" exited with code ${code ?? 'unknown'}.`,
        {
          runtimeId: activeSession.id,
          runtimeName: activeSession.name,
          notebookId,
          notebookName,
        }
      );
    });

    res.json({ ok: true, run: runState, runtime: activeSession });
  });

  // Stop Notebook Execution
  app.post('/api/colab/notebooks/stop', (req: Request, res: Response) => {
    const notebookId = typeof req.body?.notebookId === 'string' ? req.body.notebookId.trim() : '';
    if (!notebookId) {
      res.status(400).json({ error: 'notebookId is required.' });
      return;
    }

    const handle = activeExecutions.get(notebookId);
    handle?.abort();
    activeExecutions.delete(notebookId);

    const run = runs.get(notebookId);
    if (run) {
      run.status = 'idle';
      const session = runtimes.get(run.runtimeId);
      if (session && session.activeNotebookId === notebookId) {
        session.activeNotebookId = null;
        session.activeNotebookName = null;
        if (session.status !== 'stopped') {
          session.status = 'ready';
        }
        broadcastEvent('runtime', session);
      }
      broadcastEvent('run', run);
      appendLog('warning', `Stopped execution of "${run.notebookName}".`, {
        runtimeId: run.runtimeId,
        runtimeName: session?.name ?? null,
        notebookId: run.notebookId,
        notebookName: run.notebookName,
      });
    }

    res.json({ ok: true });
  });

  // Clear Logs
  app.delete('/api/colab/logs', (_req: Request, res: Response) => {
    logs.length = 0;
    broadcastEvent('logs_cleared', { timestamp: new Date().toISOString() });
    res.json({ ok: true });
  });

  // GitHub Inspect
  app.post('/api/github/inspect', async (req: Request, res: Response) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Paste a GitHub notebook or repository URL.' });
      return;
    }

    try {
      const target = validateAndParseGitHubUrl(rawUrl);
      if (target.kind === 'raw_file') {
        res.json({
          kind: 'file',
          repoLabel: target.repoLabel,
          files: [
            {
              name: target.fileName,
              path: target.fileName,
              rawUrl: target.rawUrl,
              blobUrl: target.blobUrl,
            },
          ],
        });
        return;
      }

      let branch = target.branch;
      if (!branch) {
        const repoRes = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`,
          {
            headers: {
              'User-Agent': 'ColabControl-Dashboard',
              Accept: 'application/vnd.github+json',
            },
            redirect: 'error',
          }
        );
        if (!repoRes.ok) {
          throw new Error(`Could not access GitHub repository (HTTP ${repoRes.status}).`);
        }
        const repoJson = (await repoRes.json()) as { default_branch?: string };
        branch = repoJson.default_branch || 'main';
      }

      const treeRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
        {
          headers: {
            'User-Agent': 'ColabControl-Dashboard',
            Accept: 'application/vnd.github+json',
          },
          redirect: 'error',
        }
      );

      if (!treeRes.ok) {
        throw new Error(`Could not list repository files (HTTP ${treeRes.status}).`);
      }

      const treeJson = (await treeRes.json()) as {
        tree?: Array<{ path?: string; type?: string; size?: number }>;
      };

      const prefix = target.subpath ? `${target.subpath.replace(/\/+$/, '')}/` : '';
      const files: GitHubDiscoveredFile[] = (treeJson.tree ?? [])
        .filter((item) => {
          if (item.type !== 'blob' || !item.path) return false;
          if (!item.path.toLowerCase().endsWith('.ipynb')) return false;
          if (prefix && !item.path.startsWith(prefix)) return false;
          return true;
        })
        .slice(0, 60)
        .map((item) => {
          const itemPath = item.path!;
          const encodedPath = itemPath.split('/').map(encodeURIComponent).join('/');
          return {
            name: itemPath.split('/').pop() || itemPath,
            path: itemPath,
            rawUrl: `https://raw.githubusercontent.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${encodeURIComponent(branch!)}/${encodedPath}`,
            blobUrl: `https://github.com/${target.owner}/${target.repo}/blob/${branch}/${itemPath}`,
            size: item.size,
          };
        });

      res.json({
        kind: 'repo',
        repoLabel: `${target.repoLabel} (${branch})`,
        files,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to inspect GitHub URL.';
      res.status(400).json({ error: msg });
    }
  });

  // GitHub Fetch validated .ipynb payload
  app.post('/api/github/fetch', async (req: Request, res: Response) => {
    const rawUrl = typeof req.body?.rawUrl === 'string' ? req.body.rawUrl.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'rawUrl is required.' });
      return;
    }

    try {
      const parsed = validateAndParseGitHubUrl(rawUrl);
      if (parsed.kind !== 'raw_file') {
        res.status(400).json({ error: 'Provide a direct .ipynb GitHub URL.' });
        return;
      }

      const fetched = await fetchValidatedNotebookFromRawUrl(parsed.rawUrl);
      appendLog('info', `Fetched "${parsed.fileName}" from GitHub (${fetched.cellCount} cells).`);

      res.json({
        fileName: parsed.fileName,
        rawUrl: parsed.rawUrl,
        blobUrl: parsed.blobUrl,
        cellCount: fetched.cellCount,
        codeCells: fetched.codeCells,
        sizeBytes: fetched.sizeBytes,
        rawJson: fetched.rawJson,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch notebook from GitHub.';
      res.status(400).json({ error: msg });
    }
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`ColabControl server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ColabControl server:', err);
  process.exit(1);
});
