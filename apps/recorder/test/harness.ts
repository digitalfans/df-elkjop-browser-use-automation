// The one test seam: a real recorder server process and a real Chrome, asserted on through the
// HTTP API and the files on disk only.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export async function waitFor<T>(what: string, fn: () => T | Promise<T>, timeout = 10_000): Promise<NonNullable<T>> {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await sleep(50);
  }
}

async function exited(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((r) => child.once('exit', r));
}

export type ApiResponse = { status: number; body: any };

export type Recorder = {
  url: string;
  recordingsDir: string;
  profilesDir: string;
  trashDir: string;
  output: () => string;
  api: (method: string, route: string, body?: unknown) => Promise<ApiResponse>;
  timeline: (ticket: string) => any[];
  ticketJson: (ticket: string) => any;
  // Stops the server process and starts a new one on the same folders and port, like reopening the app.
  restart: (signal?: NodeJS.Signals) => Promise<void>;
  close: () => Promise<void>;
};

// Starts the server as a child process with fresh recordings and Work Profiles folders and a free port.
export async function startRecorder(): Promise<Recorder> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'recorder-test-'));
  const recordingsDir = path.join(root, 'recordings');
  const profilesDir = path.join(root, 'profiles');
  // Deleted Tickets go here instead of the developer's real Trash.
  const trashDir = path.join(root, 'Trash');
  fs.mkdirSync(trashDir);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    RECORDER_PORT: String(port),
    RECORDINGS_DIR: recordingsDir,
    PROFILES_DIR: profilesDir,
    TRASH_DIR: trashDir,
    // Away from 9222, where a real Work Profile may be open on this Mac.
    FIRST_CDP_PORT: String(await freePort()),
    // Work Profiles opened from the API run headless here; for the Copywriter they are normal windows.
    CHROME_PATH: CHROME,
    CHROME_ARGS: '--headless=new',
  };
  let output = '';
  let child: ChildProcess;

  const launch = async () => {
    child = spawn(process.execPath, ['src/server.ts'], { cwd: APP_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', (d) => (output += d));
    child.stderr!.on('data', (d) => (output += d));
    try {
      await waitFor('the recorder to answer', async () => {
        if (child.exitCode !== null) throw new Error(`Recorder exited early:\n${output}`);
        return (await fetch(`${url}/api/state`).catch(() => null))?.ok;
      });
    } catch (err) {
      child.kill('SIGKILL');
      throw err;
    }
  };

  const api = async (method: string, route: string, body?: unknown): Promise<ApiResponse> => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };

  try {
    await launch();
  } catch (err) {
    await rm(root, { recursive: true, force: true });
    throw err;
  }

  const ticketFile = (ticket: string, file: string) => path.join(recordingsDir, ticket, file);
  return {
    url,
    recordingsDir,
    profilesDir,
    trashDir,
    output: () => output,
    api,
    timeline: (ticket) => {
      const file = ticketFile(ticket, 'timeline.jsonl');
      if (!fs.existsSync(file)) return [];
      return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
    ticketJson: (ticket) => JSON.parse(fs.readFileSync(ticketFile(ticket, 'ticket.json'), 'utf8')),
    restart: async (signal = 'SIGTERM') => {
      child.kill(signal);
      await exited(child);
      await launch();
    },
    close: async () => {
      // Work Profiles the server opened outlive it, like the Copywriter's Chromes; quit them first.
      const left = await api('GET', '/api/profiles').catch(() => null);
      for (const p of left?.body ?? []) {
        if (!p.open) continue;
        await api('POST', '/api/profiles/close', { name: p.name }).catch(() => {});
        const pid = chromePid(p.dir);
        if (pid && isAlive(pid)) process.kill(pid, 'SIGKILL');
      }
      child.kill();
      await exited(child);
      await rm(root, { recursive: true, force: true });
    },
  };
}

// The process a Chrome running on a user-data folder has, from the lock it holds there
// (`SingletonLock` -> `<host>-<pid>`), or null when no Chrome holds it.
export function chromePid(dir: string): number | null {
  try {
    const pid = Number(fs.readlinkSync(path.join(dir, 'SingletonLock')).split('-').at(-1));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type Chrome = { browser: Browser; context: BrowserContext; close: () => Promise<void> };

// A headless Chrome on a registered Work Profile's folder and port, which the server then sees as open.
// The test drives it through its own CDP connection, like the Copywriter driving her Chrome by hand.
export async function launchChrome(profile: { dir: string; port: number }): Promise<Chrome> {
  const child = spawn(CHROME, [
    '--headless=new', `--user-data-dir=${profile.dir}`, `--remote-debugging-port=${profile.port}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });
  await waitFor(`Chrome on port ${profile.port}`, async () =>
    (await fetch(`http://127.0.0.1:${profile.port}/json/version`).catch(() => null))?.ok);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${profile.port}`);
  return {
    browser,
    context: browser.contexts()[0],
    close: async () => {
      await browser.close().catch(() => {});
      child.kill();
      await exited(child);
    },
  };
}

// Drives a Work Profile the server opened, through its own CDP connection, like the Copywriter by hand.
export async function connectChrome(profile: { port: number }) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${profile.port}`);
  return { browser, context: browser.contexts()[0], close: () => browser.close().catch(() => {}) };
}
