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
| `TRASH_DIR`      | `~/.Trash`              | Where deleted Tickets are moved              |
| `FIRST_CDP_PORT` | `9222`                  | First debugging port given to a Work Profile |
| `CHROME_PATH`    | Google Chrome in `/Applications` | Chrome a Work Profile opens in      |
| `CHROME_ARGS`    | none                    | Extra Chrome flags, space separated (the tests pass `--headless=new`) |

Work Profiles are managed from the page: create one by name (it gets the next free debugging port from `FIRST_CDP_PORT` up), open it as a normal Chrome window, close it as a regular quit (CDP `Browser.close`, so logins are saved). Several can be open at once. The one being recorded cannot be closed. The picker next to Start recording lists only open Work Profiles and defaults to the one last used for the Ticket; each Recording Session summary names its Work Profile.

Tickets are listed from disk, newest first, with their Briefing excerpt, Recording Sessions, events and last update. Typing an existing Ticket ID opens it instead of creating a duplicate. The Briefing can be saved and edited while the Ticket is not recording (a Briefing typed but not saved is saved when recording starts). Continue recording starts a new Recording Session on the same timeline: `seq` keeps counting, screenshots are never overwritten and each session has its own trace. Delete moves the Ticket folder and its zip to the Trash after confirmation; Folder opens it in Finder. Editing the Briefing of, or deleting, the Ticket being recorded is refused.

Each Ticket folder holds `ticket.json` (Ticket, Briefing, Recording Session summaries), `timeline.jsonl`, one event per line, appended the moment it is recorded, `screenshots/` (one shortly after each meaningful event, named in the event) and `traces/session-<n>.zip`, the Playwright trace of each Recording Session (open with `npx playwright show-trace`). Next to it, `<ticket>.zip` holds the whole folder and is rebuilt at every Finish.

Recorded events: clicks, form changes, rich-text edits (settled after a 1 s pause in typing), Enter, Tab, Escape and modifier shortcuts, copy, cut and paste with their text, main-frame navigations, tabs opening and closing, in every tab and iframe of the Work Profile, including pages already open when recording starts. Password values are masked. The recorder's own page is not recorded when it is open in the Work Profile; `/demo` is.

Annotations: while recording, the Copywriter adds a **Step** (start of a new step of her process, numbered automatically), a **Checkpoint** (where she would want to verify the automation's work, and what she'd check) or an **Observation** (a decision she made from the Briefing, and why). Each is an `annotation` event with its `kind` and `text` (Steps also carry their number `n`), placed in the timeline at that moment with a screenshot of the tab she was last on, if she has been on one. Every event carries the current Step number in `step`; a new Recording Session starts in the last Step of the previous one and numbering continues. Annotating is refused when not recording, with empty text or with an unknown kind (`POST /api/annotate { kind, text }`). The page shows the current Step and highlights Annotations in the live events; Ticket and Recording Session summaries count Annotations.

Recovery: starting a Recording Session writes an open-session marker, `.open-session.json` in the recordings folder, and Finish removes it once the Recording Session's summary is in `ticket.json`. If the app finds the marker when it starts (after a crash, a closed Terminal or a Mac restart), it closes that Recording Session from the events already on disk before the API answers: its finish time is the last event's time, it is marked `recovered: true`, its trace is usually missing (`trace: null`), a last line cut off mid-write is dropped from the timeline, and the Ticket's zip is rebuilt. The page shows a notice naming the recovered Recording Session until she dismisses it (`recovered` in `GET /api/state`, `POST /api/recovery/dismiss`); undismissed notices are kept in `.recovered.json` across restarts. The Ticket is continued as usual: `seq` and the Step carry on.
