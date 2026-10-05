# Ticket recorder (PROTOTYPE, throwaway)

**Question:** can a recorder attach over CDP to a normal "work Chrome" (ADR 0001) and capture a Copywriter's manual session (semantic events, copy/paste text, screenshots, trace) without changing how the browser looks or behaves?

## On a new Mac

1. Send this folder as a zip **without** `node_modules/` and `.runtime/`, and unzip it anywhere.
2. **Right-click `Start Recorder.command` → Open** (first time only; macOS blocks a downloaded script on a plain double-click). Afterwards a double-click is enough.
3. The launcher needs nothing installed. If Node.js is missing it downloads a private copy into `.runtime/` (checksum-verified, no admin), installs Playwright, starts the server and opens http://localhost:4317. Keep its Terminal window open; closing it stops the recorder.
4. The page opens on the **Setup checklist** until everything is green: Node.js, Playwright (**Install** button), Google Chrome (install by hand if missing), zip, the recordings folder and at least one Work Profile (**Create profile** button). The **Setup** link in the header always comes back to it.

For development, `npm --prefix prototypes/recorder install && npm --prefix prototypes/recorder start` still works.

## Using it

1. **Work Profiles**: dedicated Chromes under `~/playwright-profiles/<name>/`, each on its own debugging port (9222, 9223…), so several can be open at once. **Open** one and log in to Jira, SharePoint, Coremedia… once, by hand. **Close** quits it normally.
2. **New ticket**: type the ID (an existing ID just opens that Ticket). Paste the Briefing and save it.
3. Pick the **Profile** to record (open ones only; defaults to the one last used on that Ticket) → **Start recording** → work normally in that Chrome → **Finish**. Each Start → Finish is one session; **Continue recording** on the same Ticket appends a new session to the same timeline.
4. While recording, annotate in her own words. Each annotation lands in the timeline at that moment, with a screenshot of the tab she was last on:
   - **Step**: marks the start of a new step of her process (numbered across sessions). Every later event carries `step: N`.
   - **Checkpoint**: where she wants to verify the automation's work before it continues or publishes, and what she'd check.
   - **Observation**: a decision she made from the Briefing, and why.
5. The history lists every Ticket: **Open**, **Folder**, **Delete** (moves it to the macOS Trash).

Output, one folder per Ticket under `~/playwright-recordings/`, plus `<ticket>.zip` rebuilt at every Finish:

```
<ticket>/
  ticket.json      # ticket, briefing, sessions [{ n, profile, startedAt, finishedAt, events, screenshots, annotations, tracing, errors }]
  briefing.txt
  events.json      # every event of every session: click, change, rich-text edit, special key,
                   # copy/cut/paste (with text), navigation, tabs; Playwright-style locator; passwords masked;
                   # annotations { type: 'annotation', kind: step|checkpoint|observation, text, n? };
                   # every event has `session` and `step`
  screenshots/     # NNNN-<type>.png, numbered by the event's global seq
  traces/session-N.zip   # npx playwright show-trace traces/session-1.zip
```

Environment overrides: `RECORDER_PORT`, `PROFILES_DIR`, `RECORDINGS_DIR`, `RECORDER_NO_OPEN=1` (launcher doesn't open the browser).

`/demo` is a fake CMS page for trying it without a real site.
