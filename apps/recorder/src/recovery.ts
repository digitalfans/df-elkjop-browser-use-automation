// Recovery of interrupted Recording Sessions. Starting a Recording Session leaves an open-session
// marker and Finish removes it, so a marker found when the app starts means the Recording Session was
// interrupted (a crash, a closed Terminal, a restart): it is closed from the events already on disk.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { readTicket, readTimeline, repairTimeline, ticketDir, writeTicket } from './tickets.ts';

export type OpenSession = { ticket: string; profile: string; n: number; startedAt: string };
// What the page tells the Copywriter about a recovered Recording Session, until she dismisses it.
export type RecoveryNotice = { ticket: string; session: number; events: number; finishedAt: string };

const markerFile = () => path.join(config.recordingsDir, '.open-session.json');
const noticesFile = () => path.join(config.recordingsDir, '.recovered.json');

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

export const markOpen = (s: OpenSession) => writeJson(markerFile(), s);
export const clearOpen = () => fs.rmSync(markerFile(), { force: true });

// Kept on disk, so a notice she has not dismissed survives another restart.
let notices: RecoveryNotice[] = [];

export const recoveryNotices = () => notices;

export function dismissRecoveryNotices() {
  notices = [];
  fs.rmSync(noticesFile(), { force: true });
}

function loadNotices(): RecoveryNotice[] {
  try {
    return JSON.parse(fs.readFileSync(noticesFile(), 'utf8'));
  } catch {
    return [];
  }
}

const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0];

// Runs once at app start, before the API answers, so nothing can record in the meantime.
export async function recoverInterrupted() {
  notices = loadNotices();
  if (!fs.existsSync(markerFile())) return;
  try {
    const open: OpenSession = JSON.parse(fs.readFileSync(markerFile(), 'utf8'));
    const t = readTicket(open.ticket);
    // Finish may have been interrupted after the summary was written: then there is nothing left to do.
    if (!t.sessions.some((s) => s.n === open.n)) {
      repairTimeline(t.ticket);
      const events = readTimeline(t.ticket).filter((e) => e.session === open.n);
      const dir = ticketDir(t.ticket);
      const traceFile = `traces/session-${open.n}.zip`;
      const trace = fs.existsSync(path.join(dir, traceFile)) ? traceFile : null;
      const finishedAt = new Date(Date.parse(open.startedAt) + (events.at(-1)?.t ?? 0)).toISOString();
      t.sessions.push({
        n: open.n, profile: open.profile, startedAt: open.startedAt, finishedAt, events: events.length,
        screenshots: events.filter((e) => e.screenshot && fs.existsSync(path.join(dir, e.screenshot))).length,
        annotations: events.filter((e) => e.type === 'annotation').length,
        trace, errors: trace ? [] : ['trace: not saved, the Recording Session was interrupted'], recovered: true,
      });
      writeTicket(t);
      notices.push({ ticket: t.ticket, session: open.n, events: events.length, finishedAt });
      writeJson(noticesFile(), notices);
    }
  } catch (err) {
    // A Ticket deleted by hand, or an unreadable marker: nothing left to recover.
    console.error('Could not recover the interrupted Recording Session:', err);
  }
  clearOpen();
}
