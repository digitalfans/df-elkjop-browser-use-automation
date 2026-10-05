// App settings: a small JSON file in the recordings folder, so replacing the app on update keeps them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.ts';
import { badRequest } from './errors.ts';

export type Settings = {
  // The folder her SharePoint/OneDrive client syncs; Export copies Ticket zips into it.
  exportDir: string | null;
};

const DEFAULTS: Settings = { exportDir: null };

const settingsFile = () => path.join(config.recordingsDir, 'settings.json');

export function readSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Ignoring unreadable ${settingsFile()}:`, err);
    return { ...DEFAULTS };
  }
}

// Only the fields given change. An empty export folder clears it.
export function saveSettings(changes: { exportDir?: unknown }): Settings {
  const settings = readSettings();
  if (changes.exportDir !== undefined) settings.exportDir = checkExportDir(changes.exportDir);
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
