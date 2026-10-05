#!/bin/bash
# Installs, or updates, the Elkjop Ticket Recorder on this Mac. Paste into Terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/digitalfans/df-elkjop-browser-use-automation/main/install.sh | bash
#
# Needs nothing installed and no admin rights: it uses only curl, unzip and rsync, which come with macOS,
# and the app's launcher downloads its own Node.js. Running it again updates the app and keeps every
# Ticket, Recording, Work Profile and setting, which live outside the app folder.
#
# Overrides, for testing: ELKJOP_RECORDER_DIR (where to install), ELKJOP_RECORDER_ZIP (the source zip URL),
# ELKJOP_RECORDER_NO_START=1 (install without starting). The launcher's own overrides pass through.
# Pure ASCII on purpose: with a non-English locale (e.g. sv_SE.UTF-8) the bash 3.2 that ships with macOS
# reads a non-ASCII character right after $VAR as part of the variable name.
set -euo pipefail

DEST="${ELKJOP_RECORDER_DIR:-$HOME/Elkjop Recorder}"
ZIP_URL="${ELKJOP_RECORDER_ZIP:-https://codeload.github.com/digitalfans/df-elkjop-browser-use-automation/zip/refs/heads/main}"
SHORTCUT="$HOME/Desktop/Elkjop Recorder.command"
PORT="${RECORDER_PORT:-4317}"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { say "$1"; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS."

if curl -fs --max-time 2 "http://127.0.0.1:$PORT/api/state" >/dev/null 2>&1; then
  fail "The recorder is running. Finish any recording, close its Terminal window, then run this again."
fi

say "Downloading the Elkjop Ticket Recorder..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fL --progress-bar "$ZIP_URL" -o "$TMP/app.zip" \
  || fail "Could not download the recorder. Check the internet connection (and the VPN) and try again."
unzip -q "$TMP/app.zip" -d "$TMP/src" || fail "The download is damaged. Try again."
APP_SRC="$(find "$TMP/src" -maxdepth 3 -type d -path '*/apps/recorder' | head -n 1)"
[ -n "$APP_SRC" ] && [ -f "$APP_SRC/Start Recorder.command" ] || fail "The download does not contain the recorder. Tell the developer."

if [ -d "$DEST" ]; then say "Updating ${DEST} (your Tickets and Work Profiles are kept)..."; else say "Installing into ${DEST}..."; fi
mkdir -p "$DEST"
# The private Node.js in .runtime is kept; dependencies are reinstalled for the new version.
rsync -a --delete --exclude '.runtime' "$APP_SRC/" "$DEST/"
chmod +x "$DEST/Start Recorder.command"

mkdir -p "$(dirname "$SHORTCUT")"
cat > "$SHORTCUT" <<EOF
#!/bin/bash
# Starts the Elkjop Ticket Recorder. Keep the window that opens; closing it stops the recorder.
exec "$DEST/Start Recorder.command"
EOF
chmod +x "$SHORTCUT"

say "Installed. From now on, double-click \"Elkjop Recorder\" on your Desktop to start it."
[ -n "${ELKJOP_RECORDER_NO_START:-}" ] && exit 0
rm -rf "$TMP"
trap - EXIT
exec "$DEST/Start Recorder.command"
