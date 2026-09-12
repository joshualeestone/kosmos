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
#   sh deploy/install-board.sh --apply          # install and adopt it
#   sh deploy/install-board.sh --refresh-only   # refresh an already-adopted tree
set -u

DEST="${KOSMOS_BOARD_LIBEXEC:-$HOME/.local/libexec/kosmos-board}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="${KOSMOS_BOARD_PLIST:-$HOME/Library/LaunchAgents/com.kosmos.board.plist}"
LABEL="com.kosmos.board"
NODE="${KOSMOS_BOARD_NODE:-/opt/homebrew/bin/node}"
APPLY=0
REFRESH_ONLY=0
case "${1:-}" in
  --apply) APPLY=1 ;;
  --refresh-only) APPLY=1; REFRESH_ONLY=1 ;;
esac

say() { printf '  %s\n' "$*"; }
fail() { printf 'install-board: %s\n' "$*" >&2; exit 1; }

# ---- #2870: refuse a destination that is unsafe to swap the app tree into ------
# The apply/refresh SWAPS $DEST: it moves $DEST aside to "$DEST.old.$$" and moves a
# freshly staged tree into its place. If $DEST is the filesystem root, the source
# repo, an ancestor of the source, or inside a git working tree, that swap corrupts
# or destroys something it must never touch; and a relative or dotted $DEST derives
# a broken ".new"/".old" sibling. Validate BEFORE anything is copied or moved, and
# in dry run too so the refusal is visible before an --apply.
#
# 🛑 This operates on the GLOBAL $DEST (normalizing it in place) rather than echoing
# a value a caller would capture with $(...). fail() calls `exit 1`, and inside a
# command substitution that exit only leaves the SUBSHELL -- the script would sail
# on past a refusal. Running in the main shell is what makes the refusal terminal.
validate_dest() {
  # non-empty, absolute -- a relative dest makes ".new.$$"/".old.$$" resolve against
  # an unknown cwd, so the swap is unpredictable.
  [ -n "$DEST" ] || fail "destination is empty"
  case "$DEST" in
    /*) ;;
    *)  fail "destination must be an absolute path, got '$DEST'" ;;
  esac

  # reject a '.' or '..' path component. Normalizing them would require the path to
  # exist; refusing is unambiguous and a real destination never carries them.
  # The wrapping "/...$DEST.../" adds leading+trailing slashes so a component at the
  # very start or end still matches the */./* and */../* patterns (a bare "." or a
  # trailing "/.." would otherwise miss); $DEST is already absolute so the extra
  # leading slash only ever collapses harmlessly.
  case "/$DEST/" in
    */./*|*/../*) fail "destination must not contain '.' or '..' path components: '$DEST'" ;;
  esac

  # strip trailing slashes so "/foo/" and "/foo" derive the SAME ".new" sibling,
  # but never reduce a path to empty (root is handled next).
  while :; do
    case "$DEST" in
      /)  break ;;
      */) DEST="${DEST%/}" ;;
      *)  break ;;
    esac
  done

  # reject the filesystem root explicitly -- "mv / /.old.$$" is catastrophic.
  [ "$DEST" != "/" ] || fail "refusing the filesystem root as a destination"

  # reject a destination that already exists but is not a directory. The swap
  # cannot sensibly replace a plain file, and without this the ancestor walk below
  # stops at $DEST itself and reports it as a non-directory "ancestor" of itself,
  # which reads wrong. (An existing symlink-to-file follows the link and is caught
  # here too; a not-yet-created $DEST is handled by the ancestor walk.)
  if [ -e "$DEST" ] && [ ! -d "$DEST" ]; then
    fail "destination '$DEST' already exists and is not a directory"
  fi

  # find the nearest EXISTING ancestor: $DEST itself may not exist yet on a first
  # adoption, nor its parent, so walk up until something exists.
  _anc="$DEST"
  while [ "$_anc" != "/" ] && [ ! -e "$_anc" ]; do
    _anc="$(dirname "$_anc")"
  done
  # fail closed if that ancestor cannot serve as a parent: a FILE (mkdir -p would
  # fail cryptically midway), or unresolvable.
  [ -e "$_anc" ] || fail "no existing ancestor of '$DEST' could be resolved"
  [ -d "$_anc" ] || fail "the nearest existing ancestor of '$DEST' is not a directory: '$_anc'"

  # canonicalize the existing ancestor (pwd -P reports the physical dir, resolving
  # symlinks in the path) and re-append the not-yet-created tail, so the
  # repo/worktree comparisons below see real paths rather than symlink aliases
  # that would slip past a string compare.
  _anc_real="$(cd "$_anc" 2>/dev/null && pwd -P)" || fail "could not resolve the destination's ancestor '$_anc'"
  _dest_real="$_anc_real${DEST#"$_anc"}"
  # collapse a doubled leading slash: if $_anc_real canonicalized to "/" (an ancestor
  # that is a symlink to the filesystem root) and the tail keeps its leading slash,
  # the concatenation yields "//...", which the string-prefix repo checks below would
  # fail to match against a single-slash repo path -- a false-accept. pwd -P never
  # emits interior doubled slashes, so only the leading run can occur; collapse it.
  while :; do case "$_dest_real" in //*) _dest_real="${_dest_real#/}" ;; *) break ;; esac; done
  _repo_real="$(cd "$REPO" 2>/dev/null && pwd -P)" || fail "could not resolve the source repo '$REPO'"

  # reject a destination inside a git working tree: installing INTO a checkout is
  # exactly what this script exists to prevent (the board would serve from a git
  # tree again, the #1051 bug). Checked from the nearest existing ancestor.
  # NOTE: this refusal fails OPEN if git is absent/errors (the `if` is simply false).
  # That is acceptable because the data-critical refusals -- repo-equality/ancestry and
  # the non-board marker -- use pwd -P and file tests, not git, so they still fire on a
  # git-less box. Only this defense-in-depth #1051 check relaxes.
  if git -C "$_anc_real" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "destination is inside a git working tree ('$_anc_real'); the board must NOT run from a checkout -- set KOSMOS_BOARD_LIBEXEC to a path outside any git working tree"
  fi

  # reject a destination equal to, inside, or ABOVE the source repo. Equal/above
  # means the swap would move the source out from under us; inside means the board
  # would serve from the checkout again.
  case "$_dest_real/" in
    "$_repo_real/"*) fail "destination '$_dest_real' is the source repo or inside it; the app tree must live OUTSIDE the checkout" ;;
  esac
  case "$_repo_real/" in
    "$_dest_real/"*) fail "destination '$_dest_real' is at or above the source repo '$_repo_real'; the swap would move the source aside" ;;
  esac

  # refuse to swap aside an existing NON-EMPTY directory that is not itself a prior
  # board install. The apply/refresh does `mv "$DEST" "$DEST.old.$$"` and then
  # `rm -rf` that old tree, so pointing $DEST at an existing populated directory (a
  # misconfigured KOSMOS_BOARD_LIBEXEC=$HOME, /usr, /Applications) would rename it
  # aside and DELETE it. A real board install carries server.js -- the file the
  # plist's ProgramArguments points at -- so require that marker before we are
  # willing to move a populated directory out of the way. A destination that does
  # not exist yet (first adoption) or is empty is safe to swap and is allowed.
  #
  # The board-install marker is server.js AND an engine/ directory. stage_app always
  # writes both, so a real board carries both; requiring both (not server.js alone)
  # shrinks the false-accept to a directory that happens to have a top-level server.js
  # AND a top-level engine/ dir -- a user's own Node project set as the dest by mistake
  # carries server.js far more often than it carries a sibling engine/, so the extra
  # marker meaningfully narrows the data-loss vector. A directory missing either marker
  # is refused (the safe direction: point the operator at a fresh path).
  if [ -e "$_dest_real" ]; then
    # Under normal flow this is unreachable (an existing non-directory $DEST was already
    # refused by the earlier ancestor check), so it is a TOCTOU backstop: if the dir is
    # swapped for a file between that check and here, fail rather than proceed.
    [ -d "$_dest_real" ] || fail "destination '$_dest_real' exists and is not a directory"
    # Enumerate the contents. An enumeration FAILURE (a root-owned or otherwise
    # unreadable directory) must fail CLOSED: we cannot prove it empty or a board,
    # and treating an unreadable dir as "empty" would let the swap mv-aside and
    # rm -rf a populated directory we never actually inspected. Capture ls's exit
    # status (the `|| fail` on the assignment) rather than only its output.
    _entries="$(ls -A "$_dest_real" 2>/dev/null)" || fail "could not read destination '$_dest_real' to check it is safe to replace; refusing"
    # server.js must be a regular FILE (the plist runs it), not merely present: a
    # directory literally named server.js would satisfy -e and let a non-board dir be
    # misclassified as a board and destroyed. -f (matches intent, follows a symlink to
    # a file) is strictly safer.
    if [ -n "$_entries" ] && { [ ! -f "$_dest_real/server.js" ] || [ ! -d "$_dest_real/engine" ]; }; then
      fail "destination '$_dest_real' is a non-empty directory that is not a board install (needs both a server.js file and an engine/ directory); refusing to move it aside and delete it -- point KOSMOS_BOARD_LIBEXEC at a fresh path or an existing board tree"
    fi
  fi
}
validate_dest

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
say "  bin/agent-supervisor.sh, bin/codex-report-bridge.js, bin/board-watchdog.sh"
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
  # #2955: staged for parity with the release bundle (the board deploy and the
  # bundle must carry the same app files, tools/test-board-deploy-manifest.sh).
  # The watchdog itself is a macOS launchd mechanism a server deploy never
  # registers, so it is inert here, but a deployed board must not be missing an
  # app file the bundle ships.
  cp "$REPO/bin/board-watchdog.sh" "$_d/bin/" || return 1
  chmod +x "$_d/bin/board-watchdog.sh"
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

if [ "$REFRESH_ONLY" -eq 1 ]; then
  say "refresh complete; the caller owns the restart"
  exit 0
fi

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
