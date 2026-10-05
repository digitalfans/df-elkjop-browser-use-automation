import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Data lives outside the app folder, so replacing the app on update never touches it.
export const config = {
  port: Number(process.env.RECORDER_PORT ?? 4317),
  recordingsDir: process.env.RECORDINGS_DIR ?? path.join(os.homedir(), 'elkjop-recordings'),
  // Shared with the prototype, so Work Profiles already logged in keep their sessions.
  profilesDir: process.env.PROFILES_DIR ?? path.join(os.homedir(), 'playwright-profiles'),
  // Deleted Tickets are moved here, so a wrong click is recoverable.
  trashDir: process.env.TRASH_DIR ?? path.join(os.homedir(), '.Trash'),
  firstCdpPort: Number(process.env.FIRST_CDP_PORT ?? 9222),
  // The Google Chrome a Work Profile opens in, looked up again each time until found, so installing
  // Chrome while the app runs is picked up by "Check again". Extra flags for it (the tests run it headless).
  get chromePath() {
    return process.env.CHROME_PATH ?? findChrome();
  },
  chromeArgs: (process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean),
};

const BINARY = path.join('Contents', 'MacOS', 'Google Chrome');
const USUAL = ['/Applications', path.join(os.homedir(), 'Applications')].map((dir) => path.join(dir, 'Google Chrome.app', BINARY));
let found: string | null = null;

// The usual places first, then anywhere Spotlight knows Chrome by its app ID: company-managed Macs
// sometimes install it elsewhere or under another name (a subfolder, "Google Chrome 2.app").
function findChrome(): string {
  if (found && fs.existsSync(found)) return found;
  found = USUAL.find((b) => fs.existsSync(b)) ?? spotlightChrome();
  return found ?? USUAL[0];
}

function spotlightChrome(): string | null {
  try {
    const apps = execFileSync('/usr/bin/mdfind', ["kMDItemCFBundleIdentifier == 'com.google.Chrome'"], { encoding: 'utf8', timeout: 5000 });
    return apps.split('\n').filter(Boolean).map((app) => path.join(app, BINARY)).find((b) => fs.existsSync(b)) ?? null;
  } catch {
    return null; // Spotlight off or slow: the checklist then says where it looked
  }
}
