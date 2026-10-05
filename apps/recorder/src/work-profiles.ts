// Work Profiles: dedicated Chrome user-data directories, each on its own debugging port (ADR 0001).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.ts';
import { HttpError, badRequest, conflict, notFound } from './errors.ts';

export type WorkProfile = { name: string; port: number; createdAt: string };

const META = '.recorder-profile.json';
const profileDir = (name: string) => path.join(config.profilesDir, name);

function readAll(): WorkProfile[] {
  if (!fs.existsSync(config.profilesDir)) return [];
  return fs.readdirSync(config.profilesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(config.profilesDir, d.name, META)))
    .map((d) => JSON.parse(fs.readFileSync(path.join(config.profilesDir, d.name, META), 'utf8')) as WorkProfile)
    .sort((a, b) => a.port - b.port);
}

export async function isOpen(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

export async function listProfiles() {
  return Promise.all(readAll().map(async (p) => ({ ...p, dir: profileDir(p.name), open: await isOpen(p.port) })));
}

export function getProfile(name: string): WorkProfile {
  const p = readAll().find((x) => x.name === name);
  if (!p) throw notFound(`Unknown Work Profile ${name}`);
  return p;
}

export function createProfile(name: string | undefined) {
  if (!name || !/^[\w-]+$/.test(name)) throw badRequest('Work Profile name: letters, numbers, - and _ only');
  if (fs.existsSync(profileDir(name))) throw conflict(`A folder named ${name} already exists in ${config.profilesDir}`);
  const used = new Set(readAll().map((p) => p.port));
  let port = config.firstCdpPort;
  while (used.has(port)) port++;
  const p: WorkProfile = { name, port, createdAt: new Date().toISOString() };
  fs.mkdirSync(profileDir(name), { recursive: true });
  fs.writeFileSync(path.join(profileDir(name), META), JSON.stringify(p, null, 2));
  return { ...p, dir: profileDir(name) };
}

async function until(check: () => boolean | Promise<boolean>, timeout: number) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(100)) if (await check()) return true;
  return check();
}

// A normal Chrome window: real Keychain, no automation flags. The recorder only attaches over its port.
export async function openProfile(name: string | undefined) {
  const p = getProfile(name ?? '');
  if (await isOpen(p.port)) return;
  if (!fs.existsSync(config.chromePath)) throw new HttpError(500, `Google Chrome is not installed (${config.chromePath})`);
  const chrome = spawn(config.chromePath, [
    `--user-data-dir=${profileDir(p.name)}`, `--remote-debugging-port=${p.port}`,
    '--no-first-run', '--no-default-browser-check', ...config.chromeArgs,
  ], { detached: true, stdio: 'ignore' });
  chrome.unref(); // it is the Copywriter's Chrome: it outlives the recorder
  let exited = false;
  chrome.on('exit', () => (exited = true));
  chrome.on('error', () => (exited = true));
  // A Chrome already running on this folder without its port takes the window over, and this one exits.
  if (!(await until(async () => exited || (await isOpen(p.port)), 15_000)) || !(await isOpen(p.port))) {
    throw conflict(`${p.name} did not open its debugging port ${p.port}. If it is already open, quit that Chrome and open it from here.`);
  }
}

// Quits through CDP Browser.close, the same as Cmd+Q, so Chrome saves its cookies and logins.
export async function closeProfile(name: string | undefined) {
  const p = getProfile(name ?? '');
  if (!(await isOpen(p.port))) return;
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${p.port}/json/version`)).json();
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    ws.onmessage = () => resolve();
    ws.onclose = () => resolve();
    ws.onerror = () => reject(new Error(`Could not reach ${p.name} on port ${p.port}`));
  });
  // Done once Chrome has let go of its folder, so the logins are on disk.
  const lock = path.join(profileDir(p.name), 'SingletonLock');
  const gone = await until(async () => !(await isOpen(p.port)) && !isLink(lock), 15_000);
  if (!gone) throw new HttpError(500, `${p.name} did not quit`);
}

function isLink(file: string) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}
