#!/bin/bash
# PROTOTYPE — double-click to start the Ticket recorder on this Mac.
# Needs nothing installed: if Node.js is missing it downloads a private copy into this folder (no admin).
set -euo pipefail

cd "$(dirname "$0")"
NODE_VERSION="v22.22.1"
RUNTIME="$PWD/.runtime"
PORT="${RECORDER_PORT:-4317}"
URL="http://localhost:$PORT"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if curl -fs "$URL/api/state" >/dev/null 2>&1; then
  say "The recorder is already running. Opening it…"
  open "$URL"
  exit 0
fi

# 1. Node.js: the system one if it's recent enough, otherwise a private copy in .runtime/
NODE=""
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then
  NODE="$(command -v node)"
elif [ -x "$RUNTIME/node/bin/node" ]; then
  NODE="$RUNTIME/node/bin/node"
else
  case "$(uname -m)" in
    arm64) ARCH="arm64" ;;
    *) ARCH="x64" ;;
  esac
  FILE="node-$NODE_VERSION-darwin-$ARCH.tar.gz"
  say "Downloading Node.js $NODE_VERSION ($ARCH) into this folder…"
  mkdir -p "$RUNTIME"
  curl -fL --progress-bar "https://nodejs.org/dist/$NODE_VERSION/$FILE" -o "$RUNTIME/$FILE"
  curl -fsL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$RUNTIME/SHASUMS256.txt"
  EXPECTED="$(grep " $FILE\$" "$RUNTIME/SHASUMS256.txt" | cut -d' ' -f1)"
  ACTUAL="$(shasum -a 256 "$RUNTIME/$FILE" | cut -d' ' -f1)"
  if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
    say "Download check failed (checksum mismatch). Nothing was installed. Try again later."
    rm -f "$RUNTIME/$FILE"
    exit 1
  fi
  rm -rf "$RUNTIME/node"
  mkdir -p "$RUNTIME/node"
  tar -xzf "$RUNTIME/$FILE" -C "$RUNTIME/node" --strip-components 1
  rm -f "$RUNTIME/$FILE" "$RUNTIME/SHASUMS256.txt"
  NODE="$RUNTIME/node/bin/node"
fi
export PATH="$(dirname "$NODE"):$PATH"
echo "Node.js $("$NODE" --version) at $NODE"

# 2. Playwright (no browser download: the recorder uses the installed Google Chrome)
if [ ! -f node_modules/playwright/package.json ]; then
  say "Installing Playwright (about a minute)…"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund
fi

# 3. Start the server, then open the page once it answers
say "Starting the recorder. Keep this window open; closing it stops the recorder."
( for _ in $(seq 1 40); do
    if curl -fs "$URL/api/state" >/dev/null 2>&1; then [ -n "${RECORDER_NO_OPEN:-}" ] || open "$URL"; exit 0; fi
    sleep 0.5
  done ) &
exec "$NODE" server.mjs
