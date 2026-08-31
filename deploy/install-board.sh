#!/bin/sh
# Install the board somewhere that is NOT a git working tree (#1164).
#
# 🛑 WHY THIS EXISTS. `com.kosmos.board` runs the board straight out of a git
# checkout:
#
#   ProgramArguments   /opt/homebrew/bin/node  <repo>/server.js
#   WorkingDirectory   <repo>
#
# and `server.js` serves `web/index.html` from disk per request. So saving an
# edit, or putting that checkout on another branch, silently changes what the
# person using Kosmos is looking at, with no deploy step and no signal. #1051
# recorded exactly that happening: the board served an unmerged branch for about
# twenty minutes and nothing anywhere said so.
#
# `tools/board-serving-check.sh` already makes that VISIBLE in one command. This
# is the other half: it makes it STOP.
#
# 🔑 WHAT MAKES THIS CHEAP, MEASURED RATHER THAN ASSUMED:
#   - the app is dependency-free: `dependencies: {}`, no node_modules anywhere,
#     and server.js requires only node: builtins (control: 60 relative requires,
#     so the grep that found that could see requires at all). So a deploy is a
#     copy of the app's own files and nothing else.
#   - server.js relocates as a unit: it resolves siblings through
#     path.join(__dirname, ...) and uses process.cwd() nowhere (#1164 comment).
#
# ⚠️ IT DOES NOT USE THE INSTALLED APP AT ~/.local/share/kosmos/app. That copy
# exists and is NINE DAYS AND ~90 VERSIONS STALE (0.2.36, 2026-08-21, against a
# tree at 0.6.18), because the release pipeline restarts the board from the tree
# rather than reinstalling the app. Pointing the board at it would be a severe
# regression wearing a fix's clothes. Measured before writing a line of this.
#
# DEFAULT IS A DRY RUN. Nothing is copied and no job is touched without --apply.
#
#   sh deploy/install-board.sh            # say what would happen
#   sh deploy/install-board.sh --apply    # do it
set -u

DEST="${KOSMOS_BOARD_LIBEXEC:-$HOME/.local/libexec/kosmos-board}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="${KOSMOS_BOARD_PLIST:-$HOME/Library/LaunchAgents/com.kosmos.board.plist}"
LABEL="com.kosmos.board"
NODE="${KOSMOS_BOARD_NODE:-/opt/homebrew/bin/node}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

say() { printf '  %s\n' "$*"; }
fail() { printf 'install-board: %s\n' "$*" >&2; exit 1; }

say "source: $REPO"
say "dest:   $DEST"
say "plist:  $PLIST"
[ "$APPLY" -eq 1 ] && say "MODE:   APPLY" || say "MODE:   dry run, nothing will change"
echo

# ---- refuse to install anything but a clean, committed tree ----------------
# 🛑 Copying an uncommitted edit into the place the live board reads is the exact
# failure this script exists to prevent, and afterwards it is indistinguishable
# from a deliberate deploy.
if git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  dirty="$(git -C "$REPO" status --porcelain | wc -l | tr -d ' ')"
  head="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null)"
  branch="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  say "source is a git tree at $head on '$branch', dirty files: $dirty"
  if [ "$APPLY" -eq 1 ] && [ "$dirty" != "0" ]; then
    fail "refusing to apply from a dirty tree: commit or stash first, or you will deploy an edit nobody can identify later"
  fi
  # ⚠️ A WARNING, NOT A REFUSAL, and the asymmetry is deliberate. Deploying a
  # branch is a legitimate thing to want to do on purpose; deploying an
  # uncommitted edit is not, because nothing afterwards can tell you what it was.
  if [ "$branch" != "main" ]; then
    say "NOTE: '$branch' is not main. That is allowed and it is said out loud, because"
    say "      a branch you deployed on purpose and one you forgot to leave look the same."
  fi
else
  say "source is not a git tree (fine: that is the end state this script is for)"
fi

# ---- what would be copied --------------------------------------------------
# 🛑 AN EXPLICIT LIST, NOT AN EXCLUDE LIST, and it is the SAME list
# tools/build-kosmos-bundle.sh stages into app/. Two copies of one fact drift, so
# tools/test-board-deploy-manifest.sh asserts these two lists agree and fails if
# either moves without the other. Duplicated deliberately rather than refactoring
# a release-critical script; the guard is what makes that safe.
say "app files that would be installed:"
say "  server.js, package.json"
say "  engine/*.js excluding *.test.js"
say "  web/ (whole)"
say "  bin/agent-supervisor.sh, bin/codex-report-bridge.js"
say "  assets/Kosmos.icns when present"
echo

stage_app() {
  _d="$1"
  mkdir -p "$_d/engine" "$_d/bin" || return 1
  cp "$REPO/server.js" "$REPO/package.json" "$_d/" || return 1
  for f in "$REPO"/engine/*.js; do
    case "$f" in *.test.js) ;; *) cp "$f" "$_d/engine/" || return 1 ;; esac
  done
  cp -R "$REPO/web" "$_d/web" || return 1
  cp "$REPO/bin/agent-supervisor.sh" "$_d/bin/" || return 1
  chmod +x "$_d/bin/agent-supervisor.sh"
  cp "$REPO/bin/codex-report-bridge.js" "$_d/bin/" || return 1
  chmod +x "$_d/bin/codex-report-bridge.js"
  if [ -f "$REPO/assets/Kosmos.icns" ]; then
    mkdir -p "$_d/assets" && cp "$REPO/assets/Kosmos.icns" "$_d/assets/" || return 1
  fi
  # Bake the version, exactly as the bundle does. Without this the served page
  # shows the literal marker to a person, which is a visible regression rather
  # than a cosmetic one, so it is VERIFIED rather than assumed.
  _ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_d/package.json" | head -1)"
  [ -n "$_ver" ] || { echo "could not read the version to bake" >&2; return 1; }
  sed -i '' "s/__KOSMOS_VERSION__/$_ver/" "$_d/web/index.html" 2>/dev/null \
    || sed -i "s/__KOSMOS_VERSION__/$_ver/" "$_d/web/index.html"
  grep -q "__KOSMOS_VERSION__" "$_d/web/index.html" && {
    echo "the version marker survived the bake" >&2; return 1; }
  echo "$_ver"
}

# ---- name what is already there, rather than silently overwriting ----------
if [ -d "$DEST" ]; then
  n="$(find "$DEST" -type f 2>/dev/null | wc -l | tr -d ' ')"
  say "destination exists with $n file(s); an apply REPLACES the app tree there"
  # Stale files are worth naming because a leftover engine module from an older
  # deploy is loadable and looks like part of this one.
  if [ -d "$DEST/engine" ]; then
    for f in "$DEST"/engine/*.js; do
      [ -e "$f" ] || continue
      b="$(basename "$f")"
      [ -f "$REPO/engine/$b" ] || say "  STALE, not in the source any more: engine/$b"
    done
  fi
else
  say "destination does not exist yet; an apply creates it"
fi
echo

if [ "$APPLY" -eq 0 ]; then
  say "dry run complete. Nothing was copied and no job was touched."
  say "Re-run with --apply to install, then confirm with:"
  say "  bash tools/board-serving-check.sh"
  exit 0
fi

# ---- apply -----------------------------------------------------------------
tmp="$DEST.new.$$"
rm -rf "$tmp" || fail "could not clear $tmp"
ver="$(stage_app "$tmp")" || { rm -rf "$tmp"; fail "staging failed; nothing was changed"; }
say "staged version $ver"

# Swap rather than copy-over, so a failed copy cannot leave a half-updated tree
# that the board would happily load.
old="$DEST.old.$$"
[ -d "$DEST" ] && { mv "$DEST" "$old" || fail "could not move the old tree aside"; }
mv "$tmp" "$DEST" || { [ -d "$old" ] && mv "$old" "$DEST"; fail "could not move the new tree into place; the old one is restored"; }
rm -rf "$old"
say "installed to $DEST"

# ---- repoint the job, then READ IT BACK ------------------------------------
[ -f "$PLIST" ] || fail "no plist at $PLIST; nothing to repoint"
cp "$PLIST" "$PLIST.bak.$$" || fail "could not back up the plist"
say "plist backed up to $PLIST.bak.$$"

/usr/libexec/PlistBuddy -c "Set :ProgramArguments:1 $DEST/server.js" "$PLIST" >/dev/null 2>&1 \
  || fail "could not set ProgramArguments:1"
/usr/libexec/PlistBuddy -c "Set :WorkingDirectory $DEST" "$PLIST" >/dev/null 2>&1 \
  || fail "could not set WorkingDirectory"

# 🛑 READ IT BACK. Asserting what you wrote is not evidence that it is what the
# file says; this is the check the relay installer earned the hard way.
got_prog="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:1' "$PLIST" 2>/dev/null)"
got_wd="$(/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' "$PLIST" 2>/dev/null)"
[ "$got_prog" = "$DEST/server.js" ] || fail "plist did not take the program path: got '$got_prog'"
[ "$got_wd" = "$DEST" ] || fail "plist did not take the working directory: got '$got_wd'"
say "plist reads back correctly: $got_prog"

launchctl unload "$PLIST" >/dev/null 2>&1
launchctl load "$PLIST" >/dev/null 2>&1 || fail "could not reload $LABEL"
say "reloaded $LABEL"
echo
say "done. CONFIRM IT RATHER THAN TRUSTING THIS MESSAGE:"
say "  bash tools/board-serving-check.sh"
