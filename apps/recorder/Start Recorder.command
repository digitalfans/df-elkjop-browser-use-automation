#!/bin/bash
# Double-click to start the recorder on this Mac (the first time: right-click -> Open).
# Needs nothing installed and no admin rights: if this Mac has no recent enough Node.js, it downloads
# a private, checksum-verified copy into this folder. Keep this window open; closing it stops the recorder.
#
# Environment overrides, for testing: RECORDER_PORT, RECORDINGS_DIR, PROFILES_DIR (and the app's other
# variables, see README.md), RECORDER_NO_OPEN=1 to not open the browser, RECORDER_NODE_MIRROR for
# where Node.js is downloaded from.
set -euo pipefail

cd "$(dirname "$0")"
APP="$PWD"
NODE_VERSION="v22.22.1"
MIRROR="${RECORDER_NODE_MIRROR:-https://nodejs.org/dist}"
RUNTIME="$APP/.runtime"
export RECORDER_PORT="${RECORDER_PORT:-4317}"
URL="http://localhost:$RECORDER_PORT"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { say "$1"; exit 1; }
answers() { curl -fs --max-time 2 "http://127.0.0.1:$RECORDER_PORT/api/state" >/dev/null 2>&1; }
open_page() {
  if [ -n "${RECORDER_NO_OPEN:-}" ]; then echo "The recorder is at $URL"; else echo "Opening $URL"; open "$URL"; fi
}

# 0. Already running: a second double-click just opens the page.
if answers; then
  say "The recorder is already running."
  open_page
  exit 0
fi

# 1. Node.js: the system one if it is recent enough for the app, otherwise a private copy in .runtime/
MIN="$(sed -n 's/.*"node": *">=\([0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' package.json | head -n 1)"
MIN="${MIN:-22.18}"
recent_enough() {
  "$1" -e "const [a, b] = process.versions.node.split('.').map(Number), [x, y] = '$MIN'.split('.').map(Number);
    process.exit(a > x || (a === x && b >= y) ? 0 : 1)" >/dev/null 2>&1
}

NODE=""
if command -v node >/dev/null 2>&1 && recent_enough "$(command -v node)"; then
  NODE="$(command -v node)"
elif [ -x "$RUNTIME/node/bin/node" ] && recent_enough "$RUNTIME/node/bin/node"; then
  NODE="$RUNTIME/node/bin/node"
else
  # Apple Silicon even when this Terminal runs under Rosetta.
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ]; then ARCH="arm64"; else ARCH="x64"; fi
  FILE="node-$NODE_VERSION-darwin-$ARCH.tar.gz"
  say "Downloading Node.js $NODE_VERSION ($ARCH) into this folder..."
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fL --progress-bar "$MIRROR/$NODE_VERSION/$FILE" -o "$TMP/$FILE" \
    || fail "Could not download Node.js. Nothing was installed. Check the internet connection and try again."
  curl -fsSL "$MIRROR/$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt" \
    || fail "Could not download the Node.js checksums. Nothing was installed. Check the internet connection and try again."
  EXPECTED="$(awk -v f="$FILE" '$2 == f { print $1 }' "$TMP/SHASUMS256.txt")"
  ACTUAL="$(shasum -a 256 "$TMP/$FILE" | cut -d' ' -f1)"
  if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
    fail "The Node.js download does not match its official checksum. Nothing was installed. Try again later."
  fi
  mkdir -p "$TMP/node"
  tar -xzf "$TMP/$FILE" -C "$TMP/node" --strip-components 1
  rm -rf "$RUNTIME/node"
  mkdir -p "$RUNTIME"
  mv "$TMP/node" "$RUNTIME/node"
  rm -rf "$TMP"
  trap - EXIT
  NODE="$RUNTIME/node/bin/node"
fi
# npm's shebang needs this Node first on the PATH.
export PATH="$(dirname "$NODE"):$PATH"
NPM="$(dirname "$NODE")/npm"
[ -x "$NPM" ] || NPM="npm"
echo "Node.js $("$NODE" --version) at $NODE"

# 2. Dependencies, without any browser download: Work Profiles open in the installed Google Chrome.
if [ ! -f node_modules/playwright/package.json ]; then
  say "Installing Playwright (about a minute)..."
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 "$NPM" ci --omit=dev --no-audit --no-fund \
    || fail "Could not install Playwright. Check the internet connection and try again."
fi

# 3. Start the server in this window, and open the page once it answers.
say "Starting the recorder. Keep this window open; closing it stops the recorder."
(
  for _ in $(seq 1 120); do
    if answers; then open_page; exit 0; fi
    sleep 0.5
  done
) &
exec "$NODE" src/server.ts
