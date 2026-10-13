#!/bin/sh
# test-update-locked-app-4455.sh -- setup.sh's #4455 lift-then-check: before an update removes any of the three
# installed parts (bin, app, runtime), all three are made writable and, where that failed, checked for something
# rm cannot remove. A part that cannot be removed refuses the update with NOTHING removed (it used to be found
# after `bin` was already gone: half an install and a paused board).
#
# setup.sh is served as one curl|sh file and sources nothing, so this extracts the exact shipped bytes (the
# BEGIN/END #4455 block) and drives them in a child sh against a sandbox install.
#
# Arms:
#   READONLY  a read-only app (what KOSMOS_READONLY_APP leaves) is lifted and the update goes on      (the normal case)
#   LOCKED    a locked file in app/ (chflags uchg, macOS): refused, the path named, nothing removed   (the card's case)
#   NODIR     a folder that cannot be made writable (chmod stubbed to fail): refused, nothing removed
#   HARMLESS  chmod fails and nothing is stuck: the update goes on                    (a failed chmod alone is no refusal)
#   CONTROL   the old line (a tolerated chmod) on the LOCKED fixture goes on to remove bin: the arm can fail
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
[ -f "$SETUP" ] || { echo "FAIL: cannot find install/setup.sh at $SETUP" >&2; exit 1; }

BLOCK="$(awk '/^  # BEGIN #4455 lift-then-check$/{f=1; next} /^  # END #4455 lift-then-check$/{f=0} f' "$SETUP")"
case "$BLOCK" in *'chmod -R u+w "$dest/$part"'*'-flags +uchg'*'return 1'*) : ;;
  *) echo "FAIL: could not extract the #4455 lift-then-check block (anchor drift?)" >&2; exit 1 ;; esac
# The block must sit BEFORE the loop that removes the parts, or it checks nothing in time.
ORDER="$(awk '/^  # END #4455 lift-then-check$/{e=NR} /^    rm -rf "\$dest\/\$part" \|\| \{ rm -rf "\$stage"; return 1; \}$/{r=NR} END{print (e && r && e < r) ? "ok" : "bad"}' "$SETUP")"

PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); echo "ok   $*"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL $*"; }
[ "$ORDER" = ok ] && ok "the check ends before the swap's first removal" || bad "the check is not before the swap's removal loop in setup.sh"

SB="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-locked-4455.XXXXXX")" || { echo "FAIL: no temp dir" >&2; exit 1; }
cleanup() {
  # The fixtures lock things on purpose; unlock before removing, or the sandbox outlives the test.
  [ "$(uname -s)" = "Darwin" ] && chflags -R nouchg "$SB" 2>/dev/null
  /bin/chmod -R u+w "$SB" 2>/dev/null
  rm -rf "$SB"
}
trap cleanup EXIT

# One sandbox install: the three parts, each with a file, and a stage as the updater has one.
mk_install() {
  d="$SB/$1"; mkdir -p "$d/bin" "$d/app/engine" "$d/runtime/bin" "$d/.kosmos.stage.1/app"
  echo k > "$d/bin/kosmos"; echo s > "$d/app/server.js"; echo e > "$d/app/engine/x.js"; echo n > "$d/runtime/bin/node"
  echo new > "$d/.kosmos.stage.1/app/server.js"
  echo "$d"
}

# Run the shipped block as the updater does: inside a function, with dest, stage and info. Prints the block's
# own lines, then RC=<n>. $2 = a directory to put FIRST on PATH (a chmod stub), or "".
run_block() {
  _dest="$1"; _stub="${2:-}"
  cat > "$SB/driver.sh" <<DRIVER
info()  { printf '     %s\n' "\$*"; }
lift() {
  local dest="\$1"
  local stage="\$dest/.kosmos.stage.1"
  local part
$BLOCK
  return 0
}
lift "\$1"
echo "RC=\$?"
DRIVER
  if [ -n "$_stub" ]; then PATH="$_stub:$PATH" sh "$SB/driver.sh" "$_dest" 2>&1
  else sh "$SB/driver.sh" "$_dest" 2>&1; fi
}
all_there() { [ -f "$1/bin/kosmos" ] && [ -f "$1/app/server.js" ] && [ -f "$1/app/engine/x.js" ] && [ -f "$1/runtime/bin/node" ]; }

# ---- READONLY: what the read-only switch leaves is lifted, and the update goes on
D="$(mk_install readonly)"; chmod -R a-w "$D/app"
[ ! -w "$D/app/engine" ] && ok "CONTROL READONLY: the app starts read-only" || bad "CONTROL READONLY: the fixture's app is writable (running as root?)"
OUT="$(run_block "$D")"
case "$OUT" in *"RC=0"*) ok "READONLY: a read-only app does not refuse the update" ;; *) bad "READONLY: refused: $OUT" ;; esac
[ -w "$D/app" ] && [ -w "$D/app/engine" ] && [ -w "$D/app/server.js" ] && ok "READONLY: the app is writable again" || bad "READONLY: the app was not lifted"
[ -d "$D/.kosmos.stage.1" ] && ok "READONLY: the stage is kept for the swap" || bad "READONLY: the stage was removed on the way through"

# ---- NODIR: a folder that stays unwritable. chmod is stubbed to fail and change nothing, which is what a real
# chmod does to a folder this user does not own.
STUB="$SB/stub"; mkdir -p "$STUB"; printf '#!/bin/sh\nexit 1\n' > "$STUB/chmod"; /bin/chmod +x "$STUB/chmod"
D="$(mk_install nodir)"; /bin/chmod a-w "$D/app/engine"
OUT="$(run_block "$D" "$STUB")"
case "$OUT" in *"RC=1"*) ok "NODIR: a folder that cannot be unlocked refuses the update" ;; *) bad "NODIR: not refused: $OUT" ;; esac
case "$OUT" in *"$D/app/engine"*) ok "NODIR: the refusal names the folder" ;; *) bad "NODIR: the folder is not named: $OUT" ;; esac
case "$OUT" in *"Nothing was removed"*) ok "NODIR: it says nothing was removed" ;; *) bad "NODIR: no such sentence: $OUT" ;; esac
all_there "$D" && ok "NODIR: bin, app and runtime are all still there" || bad "NODIR: a part was removed"
[ ! -e "$D/.kosmos.stage.1" ] && ok "NODIR: the stage is cleared, as every other refusal of the swap does" || bad "NODIR: the stage was left behind"

# ---- HARMLESS: chmod fails and nothing is stuck. Not a refusal: rm removes a file whatever its own mode, so long
# as its folder is writable.
D="$(mk_install harmless)"
OUT="$(run_block "$D" "$STUB")"
case "$OUT" in *"RC=0"*) ok "HARMLESS: a failed chmod with nothing stuck does not refuse" ;; *) bad "HARMLESS: refused: $OUT" ;; esac
case "$OUT" in *"cannot be replaced"*) bad "HARMLESS: it printed the refusal: $OUT" ;; *) ok "HARMLESS: no refusal is printed" ;; esac

# ---- LOCKED: the card's case, a locked file (the Finder's Locked box). macOS only: the flag is BSD's.
if [ "$(uname -s)" = "Darwin" ]; then
  D="$(mk_install locked)"; chflags uchg "$D/app/engine/x.js"
  if rm -f "$D/app/engine/x.js" 2>/dev/null; then
    bad "CONTROL LOCKED: the locked file could be removed, so the fixture locks nothing"
  else
    ok "CONTROL LOCKED: rm cannot remove the locked file"
    OUT="$(run_block "$D")"
    case "$OUT" in *"RC=1"*) ok "LOCKED: a locked file refuses the update" ;; *) bad "LOCKED: not refused: $OUT" ;; esac
    case "$OUT" in *"$D/app/engine/x.js"*) ok "LOCKED: the refusal names the file" ;; *) bad "LOCKED: the file is not named: $OUT" ;; esac
    all_there "$D" && ok "LOCKED: bin, app and runtime are all still there" || bad "LOCKED: a part was removed"

    # CONTROL: the line this replaced (a tolerated chmod, then the swap's removals) on the same fixture. It must
    # lose `bin` and then fail at `app`, or the LOCKED arm above proves nothing about what it prevents.
    D="$(mk_install lockedold)"; chflags uchg "$D/app/engine/x.js"
    for part in bin app runtime; do [ -d "$D/$part" ] && chmod -R u+w "$D/$part" 2>/dev/null || true; done
    OLD=went-through
    for part in bin app runtime; do rm -rf "$D/$part" 2>/dev/null || { OLD="stopped-at-$part"; break; }; done
    [ "$OLD" = stopped-at-app ] && [ ! -e "$D/bin" ] \
      && ok "CONTROL: without the check the same fixture loses bin and stops at app" \
      || bad "CONTROL: the old behaviour did not fail as the card describes ($OLD)"
  fi
else
  echo "SKIP LOCKED: the locked-file flag is macOS's (this is $(uname -s)); NODIR covers the refusal here"
fi

echo
echo "test-update-locked-app-4455: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
