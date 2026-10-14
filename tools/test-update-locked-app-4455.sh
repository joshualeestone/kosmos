#!/bin/sh
# test-update-locked-app-4455.sh -- setup.sh's #4455 lift-then-check: before an update removes any of the three
# installed parts (bin, app, runtime), all three are made writable and checked for something rm cannot remove.
# A part that cannot be removed refuses the update with NOTHING removed (it used to be found after `bin` was
# already gone: half an install and a paused board).
#
# setup.sh is served as one curl|sh file and sources nothing, so this extracts the exact shipped bytes (the
# BEGIN/END #4455 block, and the installer's own two shell-option lines) and drives them in a child sh against a
# sandbox install. The options matter: under the installer's pipefail a find that exits non-zero used to throw
# away the path it had found (review 1), and a driver without them was green over that.
#
# Arms:
#   READONLY  a read-only app (what the installer leaves) is lifted and the update goes on            (the normal case)
#   NOREAD    a folder with no permissions at all, owned by this user, is lifted and CAN then be removed
#   LOCKED    a locked file in app/ (chflags uchg, macOS): refused, the path named, nothing removed   (the card's case)
#   NODIR     a folder that cannot be made writable (chmod stubbed to fail): refused, nothing removed
#   NOSEARCH  a folder this user may read and write but not search (chmod stubbed): refused. rm needs all three.
#   NOISY     the same, beside a folder find cannot read (find exits non-zero): STILL refused. It goes red if the
#             search is ever given back a fallback that clears what it found (`|| _stuck_at=""`), which is the
#             fault it was written for. It does NOT depend on the `|| true` inside the substitution (review 2).
#   RELOCK    a refused update leaves the app as it found it: read-only again if it was read-only (the lift had
#             opened it), writable if it was writable. macOS only, like LOCKED: it needs a refusal that happens
#             AFTER a lift that worked, and the chmod stub of the other refusing arms fails every chmod.
#   EMPTY     an unwritable EMPTY folder (chmod stubbed): not refused, rm removes it through its parent
#   HARMLESS  chmod fails and nothing is stuck: the update goes on                    (a failed chmod alone is no refusal)
#   CONTROL   the old line (a tolerated chmod) on the LOCKED fixture goes on to remove bin: the arm can fail
#   GNUFIND   the LOCKED fixture with a find first on PATH that knows no -flags: still refused (macOS only)
#
# On Linux the Darwin-only block (LOCKED, RELOCK, CONTROL, GNUFIND) skips. The installer turns pipefail on only
# under bash (its option line tests BASH_VERSION), and Ubuntu's sh is dash, so there NOISY runs without the option
# it was written to catch; a green Linux run does not cover that fault (#6149).
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
[ -f "$SETUP" ] || { echo "FAIL: cannot find install/setup.sh at $SETUP" >&2; exit 1; }

BLOCK="$(awk '/^  # BEGIN #4455 lift-then-check$/{f=1; next} /^  # END #4455 lift-then-check$/{f=0} f' "$SETUP")"
case "$BLOCK" in *'chmod -R u+'*'"$dest/$part"'*'find "$dest/$part"'*'info "Nothing was removed."'*) : ;;
  *) echo "FAIL: could not extract the #4455 lift-then-check block (anchor drift?)" >&2; exit 1 ;; esac
# The installer's own options, from the shipped file: `set -eu`, and pipefail where the shell has it.
OPTS="$(awk '/^set -eu$/{print; getline; print; exit}' "$SETUP")"
case "$OPTS" in *'set -eu'*'set -o pipefail'*) : ;;
  *) echo "FAIL: could not extract the installer's shell options (anchor drift?)" >&2; exit 1 ;; esac
# The block must sit BEFORE the loop that removes the parts, or it checks nothing in time.
ORDER="$(awk '/^  # END #4455 lift-then-check$/{e=NR} /^    rm -rf "\$dest\/\$part" \|\| \{ rm -rf "\$stage"; return 1; \}$/{r=NR} END{print (e && r && e < r) ? "ok" : "bad"}' "$SETUP")"

PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); echo "ok   $*"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL $*"; }
[ "$ORDER" = ok ] && ok "the check ends before the swap's first removal" || bad "the check is not before the swap's removal loop in setup.sh"

SB="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-locked-4455.XXXXXX")" || { echo "FAIL: no temp dir" >&2; exit 1; }
# Everything below changes and removes things under $SB. An empty name would aim that at the root of the disk,
# so it is checked here, every use that changes anything is spelled so an empty name stops the script, and each
# sandbox install is checked to be a folder inside $SB before it is touched (in_sb).
[ -n "$SB" ] && [ -d "$SB" ] || { echo "FAIL: the temp dir is not there" >&2; exit 1; }
cleanup() {
  # The fixtures lock things on purpose; unlock before removing, or the sandbox outlives the test.
  [ "$(uname -s)" = "Darwin" ] && chflags -R nouchg "${SB:?}" 2>/dev/null
  /bin/chmod -R u+rwX "${SB:?}" 2>/dev/null
  rm -rf "${SB:?}"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# One sandbox install: the three parts, each with a file, and a stage as the updater has one.
mk_install() {
  d="${SB:?}/${1:?}"; mkdir -p "$d/bin" "$d/app/engine" "$d/runtime/bin" "$d/.kosmos.stage.1/app" || exit 1
  echo k > "$d/bin/kosmos"; echo s > "$d/app/server.js"; echo e > "$d/app/engine/x.js"; echo n > "$d/runtime/bin/node"
  echo new > "$d/.kosmos.stage.1/app/server.js"
  echo "$d"
}
in_sb() {
  case "${1:-}" in "${SB:?}"/?*) [ -d "$1" ] && return 0 ;; esac
  echo "FAIL: a sandbox install is not inside the sandbox: [${1:-}]" >&2; exit 1
}

# Run the shipped block as the updater does: under the installer's options, inside a function, with dest, stage
# and info. Prints the block's own lines, then RC=<n>. $2 = a directory to put FIRST on PATH (a chmod stub), or "".
run_block() {
  _dest="$1"; _stub="${2:-}"
  cat > "${SB:?}/driver.sh" <<DRIVER
$OPTS
info()  { printf '     %s\n' "\$*"; }
lift() {
  local dest="\$1"
  local stage="\$dest/.kosmos.stage.1"
  local part
$BLOCK
  return 0
}
[ -n "\${1:-}" ] && [ -d "\$1" ] || { echo "the driver was given no install"; exit 2; }
if lift "\$1"; then echo "RC=0"; else echo "RC=\$?"; fi
DRIVER
  if [ -n "$_stub" ]; then PATH="$_stub:$PATH" sh "$SB/driver.sh" "$_dest" 2>&1
  else sh "$SB/driver.sh" "$_dest" 2>&1; fi
}
all_there() { [ -f "$1/bin/kosmos" ] && [ -f "$1/app/server.js" ] && [ -f "$1/app/engine/x.js" ] && [ -f "$1/runtime/bin/node" ]; }
# The swap's own removals, on a sandbox install, to see whether what the block let through can really be removed.
swap_removes() {
  in_sb "$1"
  for _p in bin app runtime; do rm -rf "${1:?}/${_p:?}" 2>/dev/null || return 1; done
  return 0
}

# A chmod that fails and changes nothing, which is what a real chmod does to a folder this user does not own.
STUB="${SB:?}/stub"; mkdir -p "$STUB" || exit 1
printf '#!/bin/sh\nexit 1\n' > "$STUB/chmod"; /bin/chmod +x "$STUB/chmod"

# ---- READONLY: what the read-only switch leaves is lifted, and the update goes on
D="$(mk_install readonly)"; in_sb "$D"; /bin/chmod -R a-w "${D:?}/app"
[ ! -w "$D/app/engine" ] && ok "CONTROL READONLY: the app starts read-only" || bad "CONTROL READONLY: the fixture's app is writable (running as root?)"
OUT="$(run_block "$D")"
case "$OUT" in *"RC=0"*) ok "READONLY: a read-only app does not refuse the update" ;; *) bad "READONLY: refused: $OUT" ;; esac
[ -w "$D/app" ] && [ -w "$D/app/engine" ] && [ -w "$D/app/server.js" ] && ok "READONLY: the app is writable again" || bad "READONLY: the app was not lifted"
[ -d "$D/.kosmos.stage.1" ] && ok "READONLY: the stage is kept for the swap" || bad "READONLY: the stage was removed on the way through"

# ---- NOREAD: a folder this user owns with no permissions at all. Write alone is not enough for rm to empty it
# (review 1: lifted to write-only, the block passed it and the swap then failed with bin already gone).
D="$(mk_install noread)"; in_sb "$D"; /bin/chmod 000 "${D:?}/app/engine"
OUT="$(run_block "$D")"
case "$OUT" in *"RC=0"*) ok "NOREAD: a folder with no permissions, owned by this user, does not refuse" ;; *) bad "NOREAD: refused: $OUT" ;; esac
swap_removes "$D" && ok "NOREAD: and the swap's removals then succeed on all three parts" || bad "NOREAD: the block passed it and a removal failed"

# ---- NODIR: a folder with something in it that stays unwritable (chmod stubbed).
D="$(mk_install nodir)"; in_sb "$D"; /bin/chmod a-w "${D:?}/app/engine"
OUT="$(run_block "$D" "$STUB")"
case "$OUT" in *"RC=1"*) ok "NODIR: a folder that cannot be unlocked refuses the update" ;; *) bad "NODIR: not refused: $OUT" ;; esac
case "$OUT" in *"$D/app/engine"*) ok "NODIR: the refusal names the folder" ;; *) bad "NODIR: the folder is not named: $OUT" ;; esac
case "$OUT" in *"Nothing was removed"*) ok "NODIR: it says nothing was removed" ;; *) bad "NODIR: no such sentence: $OUT" ;; esac
case "$OUT" in *"may not change that folder"*) ok "NODIR: it says why in words that fit (not the Finder's Locked box)" ;; *) bad "NODIR: the wrong reason: $OUT" ;; esac
all_there "$D" && ok "NODIR: bin, app and runtime are all still there" || bad "NODIR: a part was removed"
[ ! -e "$D/.kosmos.stage.1" ] && ok "NODIR: the stage is cleared, as every other refusal of the swap does" || bad "NODIR: the stage was left behind"

# ---- NOSEARCH: read and write but no search bit, with something in it. rm cannot reach what is inside.
D="$(mk_install nosearch)"; in_sb "$D"; /bin/chmod 600 "${D:?}/app/engine"
if rm -f "${D:?}/app/engine/x.js" 2>/dev/null; then
  bad "CONTROL NOSEARCH: the file inside could be removed, so the fixture blocks nothing (running as root?)"
else
  ok "CONTROL NOSEARCH: rm cannot remove what is inside a folder with no search bit"
  OUT="$(run_block "$D" "$STUB")"
  case "$OUT" in *"RC=1"*) ok "NOSEARCH: a folder that cannot be searched refuses the update" ;; *) bad "NOSEARCH: not refused: $OUT" ;; esac
  case "$OUT" in *"$D/app/engine"*) ok "NOSEARCH: the refusal names the folder" ;; *) bad "NOSEARCH: the folder is not named: $OUT" ;; esac
fi

# ---- NOISY: the same stuck folder, beside one find cannot read, so find exits non-zero AFTER printing the stuck
# one. Under the installer's pipefail that status used to discard the path, and the update went on.
D="$(mk_install noisy)"; in_sb "$D"; /bin/chmod a-w "${D:?}/app/engine"; mkdir "$D/app/zz" && echo z > "$D/app/zz/f" && /bin/chmod 000 "${D:?}/app/zz"
if find "$D/app" -type d >/dev/null 2>&1; then
  bad "CONTROL NOISY: find read every folder, so the fixture makes no noise (running as root?)"
else
  ok "CONTROL NOISY: find exits non-zero on this fixture"
  OUT="$(run_block "$D" "$STUB")"
  case "$OUT" in *"RC=1"*) ok "NOISY: still refused when find itself exits non-zero" ;; *) bad "NOISY: not refused: $OUT" ;; esac
  all_there "$D" && ok "NOISY: bin, app and runtime are all still there" || bad "NOISY: a part was removed"
fi

# ---- EMPTY: an unwritable folder with nothing in it is not stuck (rm removes it through its parent). The old
# updater got through this, so refusing would be a regression.
D="$(mk_install empty)"; in_sb "$D"; mkdir "$D/app/hollow" && /bin/chmod 500 "${D:?}/app/hollow"
OUT="$(run_block "$D" "$STUB")"
case "$OUT" in *"RC=0"*) ok "EMPTY: an empty unwritable folder does not refuse" ;; *) bad "EMPTY: refused: $OUT" ;; esac
swap_removes "$D" && ok "EMPTY: and the swap's removals then succeed" || bad "EMPTY: a removal failed, so it was stuck after all"

# ---- HARMLESS: chmod fails and nothing is stuck. Not a refusal.
D="$(mk_install harmless)"; in_sb "$D"
OUT="$(run_block "$D" "$STUB")"
case "$OUT" in *"RC=0"*) ok "HARMLESS: a failed chmod with nothing stuck does not refuse" ;; *) bad "HARMLESS: refused: $OUT" ;; esac
case "$OUT" in *"cannot be replaced"*) bad "HARMLESS: it printed the refusal: $OUT" ;; *) ok "HARMLESS: no refusal is printed" ;; esac

# ---- LOCKED: the card's case, a locked file (the Finder's Locked box). macOS only: the flag is BSD's.
if [ "$(uname -s)" = "Darwin" ]; then
  D="$(mk_install locked)"; in_sb "$D"; chflags uchg "${D:?}/app/engine/x.js"
  if rm -f "${D:?}/app/engine/x.js" 2>/dev/null; then
    bad "CONTROL LOCKED: the locked file could be removed, so the fixture locks nothing"
  else
    ok "CONTROL LOCKED: rm cannot remove the locked file"
    OUT="$(run_block "$D")"
    case "$OUT" in *"RC=1"*) ok "LOCKED: a locked file refuses the update" ;; *) bad "LOCKED: not refused: $OUT" ;; esac
    case "$OUT" in *"$D/app/engine/x.js"*) ok "LOCKED: the refusal names the file" ;; *) bad "LOCKED: the file is not named: $OUT" ;; esac
    case "$OUT" in *"It is locked"*"chflags -R nouchg,nouappnd '$D/app'"*) ok "LOCKED: it says how to unlock it, on the stuck part only" ;; *) bad "LOCKED: the wrong reason or the wrong folder: $OUT" ;; esac
    all_there "$D" && ok "LOCKED: bin, app and runtime are all still there" || bad "LOCKED: a part was removed"
    # GNUFIND (#6149): a find first on PATH that knows no -flags (Homebrew findutils) must not read as "nothing
    # locked". The stub fails on -flags the way GNU find does and passes anything else to the real one.
    D2="$(mk_install lockedgnu)"; in_sb "$D2"; chflags uchg "${D2:?}/app/engine/x.js"
    GF="${SB:?}/gnufind"; mkdir -p "$GF"
    printf '%s\n' '#!/bin/sh' 'for a in "$@"; do [ "$a" = -flags ] && { echo "find: unknown predicate -flags" >&2; exit 1; }; done' 'exec /usr/bin/find "$@"' > "$GF/find"
    /bin/chmod +x "$GF/find"
    if PATH="$GF:$PATH" find "$D2" -flags +uchg >/dev/null 2>&1; then
      bad "CONTROL GNUFIND: the stub accepted -flags, so it stands in for nothing"
    else
      ok "CONTROL GNUFIND: the stub find refuses -flags, as GNU find does"
      OUT="$(run_block "$D2" "$GF")"
      case "$OUT" in *"RC=1"*"$D2/app/engine/x.js"*|*"$D2/app/engine/x.js"*"RC=1"*) ok "GNUFIND: with a GNU find first on PATH the locked file still refuses the update" ;; *) bad "GNUFIND: not refused with a GNU find first on PATH: $OUT" ;; esac
      all_there "$D2" && ok "GNUFIND: bin, app and runtime are all still there" || bad "GNUFIND: a part was removed"
    fi
    chflags -R nouchg "$D2" 2>/dev/null
    # RELOCK: this fixture's app was WRITABLE before the update, so the refusal leaves it writable.
    [ -w "$D/app" ] && [ -w "$D/app/server.js" ] && ok "RELOCK: an app that was writable is still writable after the refusal" || bad "RELOCK: the refusal locked an app that was not locked"
    # And one that was read-only (what the installer leaves) is read-only again: the lift had opened it to look.
    D="$(mk_install lockedro)"; in_sb "$D"; /bin/chmod -R a-w "${D:?}/app"; chflags uchg "${D:?}/app/engine/x.js"
    OUT="$(run_block "$D")"
    case "$OUT" in *"RC=1"*) [ ! -w "$D/app" ] && [ ! -w "$D/app/server.js" ] && [ ! -w "$D/app/engine" ] \
        && ok "RELOCK: an app that was read-only is read-only again after the refusal" || bad "RELOCK: the refusal left a read-only app writable" ;;
      *) bad "RELOCK: the read-only locked fixture was not refused: $OUT" ;; esac

    # CONTROL: the line this replaced (a tolerated chmod, then the swap's removals) on the same fixture. It must
    # lose `bin` and then fail at `app`, or the LOCKED arm above proves nothing about what it prevents.
    D="$(mk_install lockedold)"; in_sb "$D"; chflags uchg "${D:?}/app/engine/x.js"
    for part in bin app runtime; do [ -d "$D/$part" ] && /bin/chmod -R u+w "${D:?}/${part:?}" 2>/dev/null || true; done
    OLD=went-through
    for part in bin app runtime; do rm -rf "${D:?}/${part:?}" 2>/dev/null || { OLD="stopped-at-$part"; break; }; done
    [ "$OLD" = stopped-at-app ] && [ ! -e "$D/bin" ] \
      && ok "CONTROL: without the check the same fixture loses bin and stops at app" \
      || bad "CONTROL: the old behaviour did not fail as the card describes ($OLD)"
  fi
else
  echo "SKIP LOCKED: the locked-file flag is macOS's (this is $(uname -s)); NODIR covers the refusal here"
fi

# ---- DEFAULT: the line that decides whether the app is left read-only, driven with the switch unset and set.
# Lifted from the shipped file like the block above. This is what checks the DEFAULT on a Mac without a hand run
# of tools/test-install.sh (whose own #4455 checks sit past the point where the release gate stops).
LOCK="$(awk '/^  # BEGIN #4455 lock$/{f=1; next} /^  # END #4455 lock$/{f=0} f' "$SETUP")"
case "$LOCK" in *'KOSMOS_READONLY_APP'*'chmod -R a-w "$dest/app"'*) : ;;
  *) echo "FAIL: could not extract the #4455 lock lines (anchor drift?)" >&2; exit 1 ;; esac
cat > "${SB:?}/lock-driver.sh" <<DRIVER
$OPTS
info()  { printf '     %s\n' "\$*"; }
lock() {
  local dest="\$1"
$LOCK
  return 0
}
[ -n "\${1:-}" ] && [ -d "\$1" ] || { echo "the driver was given no install"; exit 2; }
lock "\$1"
DRIVER
locked()   { [ ! -w "$1/app" ] && [ ! -w "$1/app/engine" ] && [ ! -w "$1/app/server.js" ]; }
writable() { [ -w "$1/app" ] && [ -w "$1/app/engine" ] && [ -w "$1/app/server.js" ]; }
if [ "$(id -u)" -eq 0 ]; then
  echo "SKIP DEFAULT: running as root, which can write a read-only folder, so these arms would say nothing"
else
  D="$(mk_install default-unset)"; in_sb "$D"
  writable "$D" && ok "CONTROL DEFAULT: the fixture's app starts writable" || bad "CONTROL DEFAULT: the fixture's app is not writable"
  env -u KOSMOS_READONLY_APP sh "$SB/lock-driver.sh" "$D" >/dev/null 2>&1
  locked "$D" && ok "DEFAULT: with the switch unset the app is left read-only" || bad "DEFAULT: with the switch unset the app is still writable"
  [ -w "$D/bin" ] && [ -w "$D/runtime" ] && ok "DEFAULT: bin and runtime stay writable" || bad "DEFAULT: bin or runtime was made read-only"
  D="$(mk_install default-zero)"; in_sb "$D"
  KOSMOS_READONLY_APP=0 sh "$SB/lock-driver.sh" "$D" >/dev/null 2>&1
  writable "$D" && ok "DEFAULT: KOSMOS_READONLY_APP=0 leaves the app writable (the off switch)" || bad "DEFAULT: =0 did not leave the app writable"
  # Only 0 is off. Empty, 1, and words a person might try all leave it read-only.
  for _v in "" 1 no false junk; do
    D="$(mk_install "default-v${_v:-empty}")"; in_sb "$D"
    _out="$(KOSMOS_READONLY_APP="$_v" sh "$SB/lock-driver.sh" "$D" 2>&1)"
    locked "$D" && ok "DEFAULT: KOSMOS_READONLY_APP='$_v' leaves the app read-only (only 0 is off)" || bad "DEFAULT: KOSMOS_READONLY_APP='$_v' left the app writable"
    # #6149: a value that is not 0 or 1 is said aloud, so a person who set =false to opt out learns it did not.
    case "$_v" in
      ""|1) case "$_out" in *"other than 0 or 1"*) bad "DEFAULT: '$_v' printed the not-understood note" ;; *) ok "DEFAULT: '$_v' prints no note" ;; esac ;;
      *)    case "$_out" in *"other than 0 or 1"*"left read-only"*) ok "DEFAULT: '$_v' says it was not understood and the app stays read-only" ;; *) bad "DEFAULT: '$_v' gave no note: $_out" ;; esac ;;
    esac
  done
  _out="$(KOSMOS_READONLY_APP=0 sh "$SB/lock-driver.sh" "$(mk_install default-zero-note)" 2>&1)"
  case "$_out" in *"other than 0 or 1"*) bad "DEFAULT: =0 printed the not-understood note" ;; *) ok "DEFAULT: =0 prints no note" ;; esac
fi

echo
echo "test-update-locked-app-4455: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
