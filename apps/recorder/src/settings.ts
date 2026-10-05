// App settings: a small JSON file in the recordings folder, so replacing the app on update keeps them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.ts';
import { badRequest } from './errors.ts';

export type Settings = {
  // The folder her SharePoint/OneDrive client syncs; Export copies Ticket zips into it.
  exportDir: string | null;
  // Above this many GB of Recordings the page warns her; nothing is ever deleted automatically.
  diskLimitGB: number;
};

const DEFAULTS: Settings = { exportDir: null, diskLimitGB: 5 };

const settingsFile = () => path.join(config.recordingsDir, 'settings.json');

export function readSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Ignoring unreadable ${settingsFile()}:`, err);
    return { ...DEFAULTS };
  }
}

// Only the fields given change, and nothing changes when one is refused. An empty export folder clears it.
export function saveSettings(changes: { exportDir?: unknown; diskLimitGB?: unknown }): Settings {
  const settings = readSettings();
  if (changes.exportDir !== undefined) settings.exportDir = checkExportDir(changes.exportDir);
  if (changes.diskLimitGB !== undefined) settings.diskLimitGB = checkDiskLimit(changes.diskLimitGB);
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return settings;
}

function checkExportDir(value: unknown): string | null {
  if (typeof value !== 'string') throw badRequest('Export folder: a folder path, or empty to clear it');
  let dir = value.trim();
  if (!dir) return null;
  if (dir === '~' || dir.startsWith('~/')) dir = path.join(os.homedir(), dir.slice(1));
  if (!path.isAbsolute(dir)) throw badRequest('Export folder: the full path of a folder, e.g. /Users/<you>/OneDrive - <company>/Recordings');
  dir = path.resolve(dir);
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw badRequest(`Export folder ${dir} does not exist`);
  return dir;
}

// A positive number of GB, given as a number or as the text typed in the page.
function checkDiskLimit(value: unknown): number {
  const gb = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(gb) || gb <= 0) throw badRequest('Disk warning limit: a number of GB above 0, e.g. 5');
  return gb;
}
