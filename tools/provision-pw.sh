#!/usr/bin/env bash
# Provision the ONE pinned Playwright runtime the browser page-gate borrows.
#
# kosmos#1594: the gate (tools/browser-checks.sh resolve_pw) reads Playwright
# from a persistent node_modules -- $KOSMOS_PW_NODE_PATH, then ~/work/pw-runtime,
# then the MCP's npx cache. The OLD documented provision was `PW=$(mktemp -d);
# npm i playwright`, which writes to a THROWAWAY dir that is gone by the time the
# gate runs, and `npm i playwright` (or a `^1.62.1` range) does not pin the
# browser build. So the install and the run did not compose, and the gate
# silently ran whatever Chromium happened to be resolved.
#
# This script closes that: it writes to a PERSISTENT dir the gate reads, pins an
# EXACT playwright version, and installs BOTH engines the checks use. It is
# idempotent -- re-running when the pinned version is already present is a no-op.
#
#   bash tools/provision-pw.sh
#   # then the gate finds it with no KOSMOS_PW_NODE_PATH needed:
#   bash tools/browser-checks.sh
#
# THE PIN LIVES HERE, once. `~/work/pw-runtime` is not a git repo, so the version
# cannot be pinned there; browser-checks.sh points at this script by name rather
# than carrying a second copy of the number, so the two cannot drift.
set -euo pipefail

# The single source of truth for the pinned version. 1.62.1 is the current
# known-good (chromium build 1234 on disk, webkit verified to launch). Bumping
# the gate's browser build is a one-line change here and nowhere else.
PW_VERSION="1.62.1"

# The persistent runtime dir the gate reads. Overridable so a CI box can
# relocate it; the default is exactly what resolve_pw's fallback names.
PW_DIR="${KOSMOS_PW_RUNTIME_DIR:-$HOME/work/pw-runtime}"

say() { printf '%s\n' "$*"; }

command -v npm >/dev/null 2>&1 || { say "provision-pw: no npm on PATH; cannot provision Playwright." >&2; exit 1; }

installed_version() {
  # The version actually on disk, or empty. Read from the package's own
  # package.json rather than trusting the range in ours. Guard the missing-file
  # case and read the file directly (no `cat | ... | head` pipeline), so this
  # cannot fail the pipe under `set -euo pipefail`; only playwright's own
  # "version" field matches, so there is exactly one line.
  local f="$PW_DIR/node_modules/playwright/package.json"
  [ -f "$f" ] || return 0
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f"
}

mkdir -p "$PW_DIR"
cd "$PW_DIR"

if [ "$(installed_version)" = "$PW_VERSION" ]; then
  say "provision-pw: playwright $PW_VERSION already present in $PW_DIR (no-op)."
else
  say "provision-pw: installing playwright@$PW_VERSION into $PW_DIR"
  # --save-exact so the version RECORDED in this dir's own package.json is the
  # exact "1.62.1", not npm's default caret range "^1.62.1". Without it a later
  # bare `npm i` in pw-runtime could resolve a newer 1.6x and change the browser
  # build -- the exact #1594 skew. The @$PW_VERSION already pins this install;
  # --save-exact makes the on-disk record match, so the pin is airtight.
  npm i --no-audit --no-fund --save-exact "playwright@$PW_VERSION"
fi

# Install BOTH engines the checks use (chromium AND webkit). Playwright is a
# no-op when the pinned build is already downloaded, so this stays idempotent.
# Use the LOCAL pinned binary explicitly (not `npx --yes`, which could fetch a
# different playwright from the registry if local resolution ever failed and
# drive the browser install unpinned): the browser builds must come from the
# exact version we just installed.
say "provision-pw: ensuring chromium + webkit browser builds for playwright@$PW_VERSION"
./node_modules/.bin/playwright install chromium webkit

got="$(installed_version)"
if [ "$got" != "$PW_VERSION" ]; then
  say "provision-pw: expected playwright $PW_VERSION but got '${got:-none}' in $PW_DIR" >&2
  exit 1
fi

say "provision-pw: ready. The gate finds it at $PW_DIR/node_modules (no KOSMOS_PW_NODE_PATH needed)."
say "provision-pw: or export KOSMOS_PW_NODE_PATH=\"$PW_DIR/node_modules\" to force it."
