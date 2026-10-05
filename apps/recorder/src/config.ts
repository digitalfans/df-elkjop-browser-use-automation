import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Data lives outside the app folder, so replacing the app on update never touches it.
export const config = {
  port: Number(process.env.RECORDER_PORT ?? 4317),
  recordingsDir: process.env.RECORDINGS_DIR ?? path.join(os.homedir(), 'elkjop-recordings'),
  // Shared with the prototype, so Work Profiles already logged in keep their sessions.
  profilesDir: process.env.PROFILES_DIR ?? path.join(os.homedir(), 'playwright-profiles'),
  firstCdpPort: Number(process.env.FIRST_CDP_PORT ?? 9222),
  // The Google Chrome a Work Profile opens in, and extra flags for it (the tests run it headless).
  chromePath: process.env.CHROME_PATH ?? findChrome(),
  chromeArgs: (process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean),
};

function findChrome() {
  const apps = ['/Applications', path.join(os.homedir(), 'Applications')];
  const binaries = apps.map((dir) => path.join(dir, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'));
  return binaries.find((b) => fs.existsSync(b)) ?? binaries[0];
}
