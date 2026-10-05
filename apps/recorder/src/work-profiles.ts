// Work Profiles: dedicated Chrome user-data directories, each on its own debugging port (ADR 0001).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { badRequest, conflict, notFound } from './errors.ts';

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
