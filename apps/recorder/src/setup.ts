// Setup checklist: everything a Mac needs before it can record, each with what it is for, its state
// and how to fix it. Playwright is installed from here, so the app never imports it up front.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { config } from './config.ts';
import { HttpError, conflict } from './errors.ts';
import { readSettings } from './settings.ts';
import { listProfiles } from './work-profiles.ts';

export type Check = {
  id: string;
  label: string;
  // What it is for, in her words.
  help: string;
  ok: boolean;
  // Only required checks decide whether the Mac is healthy.
  required: boolean;
  // Its state, with versions and paths, or how to fix it.
  detail: string;
  // A fix the page offers as a button.
  action?: 'install' | 'create-profile';
};

const exec = promisify(execFile);
const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const manifest = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0];

export const version: string = manifest(path.join(APP_DIR, 'package.json')).version;

// Imported only when recording, so the server and its checklist run before Playwright is installed.
export async function loadPlaywright(): Promise<typeof import('playwright')> {
  if (!playwrightVersion()) throw conflict('Playwright is not installed: install it from the Setup checklist');
  return import('playwright');
}

function playwrightVersion(): string | null {
  try {
    return manifest(path.join(APP_DIR, 'node_modules', 'playwright', 'package.json')).version;
  } catch {
    return null;
  }
}

function nodeCheck(): Check {
  // The minimum the app runs on, from its manifest (native type stripping).
  const min = (manifest(path.join(APP_DIR, 'package.json')).engines?.node ?? '').match(/(\d+)\.(\d+)/);
  const [major, minor] = process.versions.node.split('.').map(Number);
  const ok = !min || major > Number(min[1]) || (major === Number(min[1]) && minor >= Number(min[2]));
  return {
    id: 'node', label: 'Node.js', help: 'Runs the recorder. The launcher sets it up.', required: true, ok,
    detail: `${process.version} at ${process.execPath}${ok ? '' : `. The recorder needs ${min![0]} or later: start it with the launcher.`}`,
  };
}

function playwrightCheck(): Check {
  const v = playwrightVersion();
  return {
    id: 'playwright', label: 'Playwright', help: 'The library that attaches to a Work Profile and records it.', required: true,
    ok: Boolean(v), detail: v ? `version ${v}` : `Not installed in ${APP_DIR}. Install it here (about a minute).`,
    ...(v ? {} : { action: 'install' as const }),
  };
}

// The .app bundle the Chrome binary is in, whose Info.plist has its version.
async function chromeVersion(binary: string) {
  const app = binary.match(/^(.*?\.app)\//)?.[1];
  if (app) {
    const plist = path.join(app, 'Contents', 'Info.plist');
    const v = await exec('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist]).catch(() => null);
    if (v) return v.stdout.trim();
  }
  const v = await exec(binary, ['--version'], { timeout: 10_000 }).catch(() => null);
  return v?.stdout.trim().match(/[\d.]+$/)?.[0] ?? 'unknown';
}

async function chromeCheck(): Promise<Check> {
  const found = fs.existsSync(config.chromePath);
  return {
    id: 'chrome', label: 'Google Chrome', help: 'The browser each Work Profile opens in. Install it by hand if it is missing.',
    required: true, ok: found,
    detail: found
      ? `version ${await chromeVersion(config.chromePath)} at ${config.chromePath}`
      : 'Not found in Applications, nor anywhere Spotlight can see. Download it from https://www.google.com/chrome, drag it to Applications, then check again.',
  };
}

function zipCheck(): Check {
  const ok = fs.existsSync('/usr/bin/zip');
  return {
    id: 'zip', label: 'zip', help: 'Packs each Ticket into one file to export. It is part of macOS.', required: true, ok,
    detail: ok ? '/usr/bin/zip' : 'Missing /usr/bin/zip, which comes with macOS. Ask the developer.',
  };
}

// Created if it is missing.
function recordingsCheck(): Check {
  const dir = config.recordingsDir;
  let detail = dir;
  let ok = true;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (err) {
    ok = false;
    detail = `${dir} cannot be written: ${firstLine(err)}`;
  }
  return { id: 'recordings', label: 'Recordings folder', help: 'Where Tickets, screenshots and traces are saved.', required: true, ok, detail };
}

async function profileCheck(): Promise<Check> {
  const names = (await listProfiles()).map((p) => p.name);
  return {
    id: 'profile', label: 'Work Profile', required: true, ok: names.length > 0,
    help: 'A dedicated Chrome for Elkjøp work. After creating it, open it and log in to the tools once, by hand.',
    detail: names.length ? `${names.join(', ')} in ${config.profilesDir}` : `None yet in ${config.profilesDir}. Create one.`,
    ...(names.length ? {} : { action: 'create-profile' as const }),
  };
}

// Shown, not required: she can record without it and set it later in the Settings.
function exportCheck(): Check {
  const dir = readSettings().exportDir;
  const ok = Boolean(dir && fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory());
  return {
    id: 'export', label: 'Export folder', help: 'The SharePoint/OneDrive folder synced on this Mac, where Export puts Ticket zips.',
    required: false, ok,
    detail: !dir ? 'Not set. Set it in the Settings to export Tickets.' : ok ? dir : `${dir} is missing. Set it again in the Settings.`,
  };
}

export async function health() {
  const checks: Check[] = [
    nodeCheck(), playwrightCheck(), await chromeCheck(), zipCheck(), recordingsCheck(), await profileCheck(), exportCheck(),
  ];
  return { version, healthy: checks.every((c) => c.ok || !c.required), checks };
}

let installing = false;

// Installs the app's runtime dependencies with the npm next to the running Node, without any browser
// download: Work Profiles open in her Google Chrome.
export async function installPlaywright() {
  if (installing) throw conflict('Already installing');
  installing = true;
  const bin = path.dirname(process.execPath);
  const npm = fs.existsSync(path.join(bin, 'npm')) ? path.join(bin, 'npm') : 'npm';
  try {
    const { stdout, stderr } = await exec(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--prefix', APP_DIR], {
      cwd: APP_DIR,
      // npm's shebang needs this Node first on the PATH.
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 10 * 60_000,
    });
    return { log: `${stdout}${stderr}`.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    throw new HttpError(500, `npm install failed: ${`${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || firstLine(err)}`);
  } finally {
    installing = false;
  }
}
