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

Each Ticket folder holds `ticket.json` (Ticket, Briefing, Recording Session summaries) and `timeline.jsonl`, one event per line, appended the moment it is recorded.
