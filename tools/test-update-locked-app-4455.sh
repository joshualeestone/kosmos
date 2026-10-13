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
#   NOISY     the same, beside a folder find cannot read (find exits non-zero): STILL refused. It goes red if the
#             search is ever given back a fallback that clears what it found (`|| _stuck_at=""`), which is the
#             fault it was written for. It does NOT depend on the `|| true` inside the substitution (review 2).
#   RELOCK    a refused update leaves the app as it found it: read-only again if it was read-only (the lift had
#             opened it), writable if it was writable. macOS only, like LOCKED: it needs a refusal that happens
#             AFTER a lift that worked, and the chmod stub of the other refusing arms fails every chmod.
#   EMPTY     an unwritable EMPTY folder (chmod stubbed): not refused, rm removes it through its parent
#   HARMLESS  chmod fails and nothing is stuck: the update goes on                    (a failed chmod alone is no refusal)
#   CONTROL   the old line (a tolerated chmod) on the LOCKED fixture goes on to remove bin: the arm can fail
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
    case "$OUT" in *"It is locked"*"untick Locked"*) ok "LOCKED: it says how to unlock it" ;; *) bad "LOCKED: the wrong reason: $OUT" ;; esac
    all_there "$D" && ok "LOCKED: bin, app and runtime are all still there" || bad "LOCKED: a part was removed"
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

echo
echo "test-update-locked-app-4455: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
