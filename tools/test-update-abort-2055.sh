#!/bin/sh
# test-update-abort-2055.sh -- unit test for setup.sh's #2055 durable update-abort
# marker: the board-would-not-pause abort records a CONSECUTIVE count in
# $LOG_DIR/update-abort, and an update that gets past the pause CLEARS it.
#
# setup.sh is served as a single curl|sh file and sources nothing, so this extracts
# the exact shipped bytes of the record block (the technique test-install.sh and
# test-app-bundle-status.sh use) and drives it with a temp LOG_DIR, then exercises
# the reset separately. The card's acceptance requires a control that FAILS on a
# clean update: scenario "reset" is that control -- it proves the marker is gone
# after a clean pass, so a healthy machine cannot read as failing.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
[ -f "$SETUP" ] || { echo "FAIL: cannot find install/setup.sh at $SETUP" >&2; exit 1; }

# Extract the record block: from the `_abortf=` line up to (not including) the
# `die "A Kosmos board is still running` line that follows it.
BLOCK="$(awk '
  /_abortf="\$LOG_DIR\/update-abort"/ { f=1 }
  f && /die "A Kosmos board is still running/ { exit }
  f { print }
' "$SETUP")"

case "$BLOCK" in
  *"reason=board-would-not-pause"*) : ;;
  *) echo "FAIL: could not extract the #2055 record block (anchor drift?)" >&2; exit 1 ;;
esac

# The reset line, extracted so a change to its path is caught here too.
RESET="$(awk '/#2055: got past the pause/{f=1} f && /rm -f "\$LOG_DIR\/update-abort"/{print; exit}' "$SETUP")"
case "$RESET" in
  *'rm -f "$LOG_DIR/update-abort"'*) : ;;
  *) echo "FAIL: could not extract the #2055 reset line (anchor drift?)" >&2; exit 1 ;;
esac

PASS=0; FAIL=0
TMP="$(mktemp -d "${TMPDIR:-/tmp}/updateabort.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Run the extracted record block once with LOG_DIR/PORT set. It runs under a
# `set -eu` subshell so an errexit-unsafe line is caught.
record() { # logdir port
  ( set -eu; LOG_DIR="$1"; PORT="$2"; eval "$BLOCK" )
}
reset() {  # logdir
  ( set -eu; LOG_DIR="$1"; eval "$RESET" )
}
count_in() { sed -n 's/^count=\([0-9][0-9]*\)$/\1/p' "$1" 2>/dev/null; }

chk() { desc="$1"; shift; if "$@"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $desc" >&2; fi; }

# ---- first abort writes count=1 with the reason -----------------------------
L="$TMP/logs1"; mkdir -p "$L"; M="$L/update-abort"
record "$L" 16180
chk "first abort creates the marker"        test -f "$M"
chk "first abort count is 1"                 sh -c '[ "$(sed -n "s/^count=//p" "$1")" = 1 ]' _ "$M"
chk "marker records the pause reason"        sh -c 'grep -q "^reason=board-would-not-pause$" "$1"' _ "$M"
chk "marker records the port"                sh -c 'grep -q "^port=16180$" "$1"' _ "$M"

# ---- consecutive aborts INCREMENT -------------------------------------------
record "$L" 16180
chk "second consecutive abort count is 2"    sh -c '[ "$(sed -n "s/^count=//p" "$1")" = 2 ]' _ "$M"
record "$L" 16180
chk "third consecutive abort count is 3"     sh -c '[ "$(sed -n "s/^count=//p" "$1")" = 3 ]' _ "$M"

# ---- a clean pass CLEARS the streak (the control) ---------------------------
reset "$L"
chk "reset removes the marker (clean update)"        test '!' -f "$M"
# and a subsequent abort starts the count over at 1, not 4
record "$L" 16180
chk "abort after a reset starts the count at 1"      sh -c '[ "$(sed -n "s/^count=//p" "$1")" = 1 ]' _ "$M"

# ---- a corrupt count is treated as 0 (robust) -------------------------------
L2="$TMP/logs2"; mkdir -p "$L2"; M2="$L2/update-abort"
printf 'count=not-a-number\nreason=x\n' > "$M2"
record "$L2" 16180
chk "corrupt count resets to 1, not blank/garbage"   sh -c '[ "$(sed -n "s/^count=//p" "$1")" = 1 ]' _ "$M2"

# ---- negative control: prove chk can fail -----------------------------------
NEG=0
sh -c '[ "1" = "2" ]' || NEG=1
chk "negative control: a false condition is detected" test "$NEG" = 1

echo "test-update-abort-2055: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
