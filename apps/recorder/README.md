# Recorder v1

Local web app the Copywriter uses to record herself resolving Tickets in a Work Profile (see `CONTEXT.md` and ADR 0001). Spec: issue #1. The prototype on branch `prototype/recorder` is the reference implementation.

TypeScript run directly by Node.js ≥ 22.18 (native type stripping), no build step. Playwright is the only runtime dependency.

```sh
npm install
npm start        # http://localhost:4317, /demo is a fake CMS page
npm test         # node:test against a real server process and a headless Google Chrome
npm run typecheck
```

Data lives outside the app folder:

| Variable         | Default                 | What                                         |
| ---------------- | ----------------------- | -------------------------------------------- |
| `RECORDER_PORT`  | `4317`                  | HTTP port                                    |
| `RECORDINGS_DIR` | `~/elkjop-recordings`   | One folder per Ticket                        |
| `PROFILES_DIR`   | `~/playwright-profiles` | Work Profiles (shared with the prototype)    |
| `FIRST_CDP_PORT` | `9222`                  | First debugging port given to a Work Profile |
| `CHROME_PATH`    | Google Chrome in `/Applications` | Chrome the tests launch             |

Each Ticket folder holds `ticket.json` (Ticket, Briefing, Recording Session summaries), `timeline.jsonl`, one event per line, appended the moment it is recorded, `screenshots/` (one shortly after each meaningful event, named in the event) and `traces/session-<n>.zip`, the Playwright trace of each Recording Session (open with `npx playwright show-trace`).

Recorded events: clicks, form changes, rich-text edits (settled after a 1 s pause in typing), Enter, Tab, Escape and modifier shortcuts, copy, cut and paste with their text, main-frame navigations, tabs opening and closing, in every tab and iframe of the Work Profile, including pages already open when recording starts. Password values are masked. The recorder's own page is not recorded when it is open in the Work Profile; `/demo` is.
