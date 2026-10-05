# Elkjøp Ticket Recorder

A small app that runs on your Mac and **records how you resolve an Elkjøp Ticket in Chrome**: what you click, type, copy and paste, which pages you open, with a screenshot after each step. While recording, you add short notes in your own words: where a new **Step** of your process starts, where you would want a **Checkpoint** to check the work, and **Observations** about the decisions you make from the Briefing.

These recordings show the developer exactly how the work is done today, so it can later be automated. Nothing is uploaded anywhere: recordings stay on your Mac until you **Export** one into your synced SharePoint/OneDrive folder.

This guide assumes **nothing is installed on the Mac** and that you have never used Terminal. Follow the steps in order; the first install takes about 10 minutes.

---

## What you need

- A **Mac** with macOS 12 (Monterey) or later, Apple Silicon (M1/M2/M3/M4) or Intel.
- An **internet connection**. If you are on a company VPN or network, it must allow `github.com`, `nodejs.org` and `registry.npmjs.org` (see [Troubleshooting](#troubleshooting)).
- **Google Chrome** (step 1 explains how to install it).
- About **1 GB of free disk space**, plus room for your recordings (the app warns you when they pass 5 GB).

You do **not** need git, Homebrew, Node.js, Xcode or administrator rights. The installer brings everything else it needs and keeps it inside its own folder.

---

## Step 1: Install Google Chrome (skip if you already have it)

1. Open **Finder** and click **Applications** in the left sidebar. If you see **Google Chrome** there, go to step 2.
2. Otherwise open **Safari**, go to **https://www.google.com/chrome** and click **Download Chrome**.
3. Open the downloaded file **googlechrome.dmg** (in Downloads) and drag the **Google Chrome** icon onto the **Applications** folder in the window that appears.
4. If your Mac asks for an administrator password or says you are not allowed to install apps, ask your IT department to install Google Chrome for you, then continue.

---

## Step 2: Open Terminal

Terminal is an app that comes with every Mac. You only use it to install and to see that the recorder is running.

1. Press **⌘ Command + Space** to open Spotlight.
2. Type **Terminal** and press **Return**.
3. A window with a text prompt opens. That's all you need.

---

## Step 3: Install the recorder (one command)

1. Copy this whole line (click the copy button on the right of the box, or select it and press **⌘ Command + C**):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/digitalfans/df-elkjop-browser-use-automation/main/install.sh | bash
   ```

2. Click inside the Terminal window, paste it with **⌘ Command + V** and press **Return**.
3. Wait. The first time takes 1 to 3 minutes. You will see, in this order:
   - `Downloading the Elkjøp Ticket Recorder…`
   - `Installing into /Users/<you>/Elkjop Recorder…`
   - `Downloading Node.js …` with a progress bar (only the first time, if your Mac doesn't have it)
   - `Installing Playwright (about a minute)…`
   - `Starting the recorder. Keep this window open; closing it stops the recorder.`
4. If macOS asks **"Terminal would like to access files in your Desktop folder"**, click **OK** (the installer puts the recorder's icon on your Desktop).
5. Your browser opens the recorder at **http://localhost:4317**.

> **Keep the Terminal window open** while you use the recorder (you can minimize it). Closing it stops the recorder.

What the installer did:
- installed the app into the folder **Elkjop Recorder** in your home folder;
- put an **Elkjop Recorder** icon on your **Desktop**, which you use to start it from now on.

---

## Step 4: Complete the Setup checklist

The first page you see is the **Setup checklist**. Each line is green ✅ when ready or red ❌ with what to do:

| Item | What to do if it is red |
|---|---|
| **Node.js** | Nothing: the installer handled it. Tell the developer if it stays red. |
| **Playwright** | Click **Install Playwright** and wait about a minute. |
| **Google Chrome** | Install it (step 1), then click **Check again**. |
| **zip** | It comes with macOS; tell the developer if it is red. |
| **Recordings folder** | Created automatically; tell the developer if it is red. |
| **Work Profile** | Type a name, for example `elkjop`, and click **Create profile**. |
| **Export folder** | Optional for now; you set it in step 6. |

When everything required is green, the page says **All set** and takes you to the recorder.

---

## Step 5: Log in once in your Work Profile

A **Work Profile** is a separate Chrome window just for your Elkjøp work. The recorder records only inside it, never your normal Chrome.

1. In the **Work Profiles** box, click **Open** next to your profile. A new Chrome window opens. It looks like a fresh Chrome, without your bookmarks; that's expected.
2. In that window, log in once, by hand, to the tools you use: **Jira**, **SharePoint**, **Celum**, **banner-naming.elkjop.app**, **Coremedia**. Chrome remembers these logins for next time.
3. From now on, do your Elkjøp work in this window.

> **Important:** while you are recording, everything you do in the Work Profile window is recorded, in every tab. Use it only for Elkjøp work, never for personal browsing.

---

## Step 6: Set the export folder (to send recordings)

Exporting puts a recording into a folder that your OneDrive/SharePoint app syncs, which is how it reaches the developer.

1. In **Finder**, find the synced SharePoint/OneDrive folder the developer asked you to use (it usually appears in the Finder sidebar under your company's name).
2. **Right-click** that folder, then hold the **⌥ Option** key: the menu item changes to **Copy "<folder>" as Pathname**. Click it.
3. In the recorder, in **Settings**, paste it into **Export folder** (**⌘ Command + V**) and click **Save**.

---

## Everyday use

**Start the recorder:** double-click **Elkjop Recorder** on your Desktop. A Terminal window opens and the recorder appears in your browser. Keep the Terminal window open.

**Record a Ticket:**
1. Type the Jira Ticket ID (for example `PM-32803`), choose its **Workflow** and click **Create or open**. The Workflows are **Enriched Content** (the default), **Virtual Categories**, **Campaign page localization** and **Banner publishing**. To add another one, open **Add a Workflow** under the Ticket box.
2. Paste the Ticket's text and comments into **Briefing** and click **Save Briefing**.
3. Make sure your Work Profile is open, choose it next to **Start recording** and click **Start recording**.
4. Do the work in the Work Profile window as you normally would.
5. While you work, write a short note in the annotation box and click:
   - **New step** when you start a new step of your process (for example "Upload the hero image");
   - **I want to check here** at a point where you would want to check the work before it continues or publishes, saying what you would check;
   - **Decision / note** to explain a decision you made from the Briefing, and why.
6. Click **Finish** when you are done or need a break.

**Continue later:** open the Ticket from the list and click **Continue recording**. The new part is added to the same recording, and Step numbering carries on.

**Send it:** open the Ticket and click **Export**. A file named like `PM-32803-20261005T141550Z.zip` appears in your export folder and syncs to the developer.

**Delete a Ticket:** click **Delete** in the list. It goes to the Trash, so you can still recover it.

**Stop the recorder:** click **Finish** if you are recording, then close the Terminal window.

If the Mac crashes, restarts or the Terminal window is closed in the middle of a recording, nothing is lost: next time you start the recorder it recovers the recording and tells you.

---

## Updating to a new version

1. Click **Finish** if you are recording, and close the recorder's Terminal window.
2. Open Terminal (step 2) and run the same command as in step 3 again:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/digitalfans/df-elkjop-browser-use-automation/main/install.sh | bash
   ```

Your Tickets, recordings, Work Profiles (and their logins) and settings are kept. The version number is shown at the top of the recorder page.

---

## Where things are on your Mac

| What | Where |
|---|---|
| The app | `Elkjop Recorder` in your home folder |
| Desktop icon | `Elkjop Recorder` on the Desktop |
| Your recordings | `elkjop-recordings` in your home folder (one folder per Ticket) |
| Work Profiles (and their logins) | `playwright-profiles` in your home folder |

To see your home folder: in Finder, press **⌘ Command + Shift + H**.

---

## Uninstalling

Close the recorder, then move these to the Trash: the **Elkjop Recorder** folder in your home folder and the **Elkjop Recorder** icon on the Desktop. To also delete all recordings and Work Profile logins, move the **elkjop-recordings** and **playwright-profiles** folders to the Trash too.

---

## Troubleshooting

**The page didn't open.** Open Chrome or Safari and go to **http://localhost:4317**. If it doesn't load, the recorder isn't running: double-click **Elkjop Recorder** on the Desktop.

**"Could not download …" during install or start.** The Mac can't reach the internet or the company network blocks a site. Check your connection, try again, and if you are on a VPN try once without it. If it keeps failing, ask IT to allow `github.com`, `raw.githubusercontent.com`, `codeload.github.com`, `nodejs.org` and `registry.npmjs.org`.

**"The recorder is running. … close its Terminal window, then run this again."** You ran the install/update command while the recorder was open. Finish any recording, close the recorder's Terminal window, and run the command again.

**Double-clicking the Desktop icon shows a warning.** Right-click the icon, choose **Open**, then **Open** again. If macOS still refuses, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. Or run the install command from step 3 again, which also starts it.

**The Work Profile asks me to log in again.** Some sites end sessions after a while. Log in again in the Work Profile window; it isn't a problem for the recorder.

**"Work Profile … is not open" when starting a recording.** Click **Open** next to the Work Profile first, then choose it next to Start recording.

**The disk warning appears.** Export the Tickets you have finished, then delete them from the list.

**Anything else.** Take a screenshot of the recorder page (the **Setup** link at the top shows versions and paths) and of the Terminal window, and send them to the developer.

---

## For developers

- The app is in [`apps/recorder`](apps/recorder): TypeScript run directly by Node.js 22, no build step, Playwright as the only runtime dependency. Its [README](apps/recorder/README.md) documents the API, data layout and tests (`npm test` runs against a real server and a headless Chrome).
- Domain vocabulary: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr`](docs/adr). Spec and tickets: GitHub issues #1–#11.
- [`install.sh`](install.sh) downloads `main` as a zip (no git needed), syncs `apps/recorder` into `~/Elkjop Recorder` (keeping its private Node.js), writes the Desktop launcher and starts the app. Overrides for testing: `ELKJOP_RECORDER_DIR`, `ELKJOP_RECORDER_ZIP`, `ELKJOP_RECORDER_NO_START=1`.
- To work on the code you need git, which macOS doesn't include: run `xcode-select --install` (or just run `git` once and accept the offer to install the Command Line Tools), then `git clone https://github.com/digitalfans/df-elkjop-browser-use-automation.git`.
