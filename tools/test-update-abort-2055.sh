#!/bin/sh
# test-update-abort-2055.sh -- unit test for setup.sh's #2055 durable update-abort
# marker: a stop at the update's pause records a CONSECUTIVE count in
# $LOG_DIR/update-abort (#4675: with its reason, and how many of the latest stops
# shared it), and an update that gets past the pause CLEARS it. Also the lines that
# read the board's own marker, KOSMOS_UPDATE_BY_BOARD (#4675).
#
# setup.sh is served as a single curl|sh file and sources nothing, so this extracts
# the exact shipped bytes of the record function (the technique test-install.sh and
# test-app-bundle-status.sh use) and drives it with a temp LOG_DIR, then exercises
# the reset separately. The card's acceptance requires a control that FAILS on a
# clean update: scenario "reset" is that control -- it proves the marker is gone
# after a clean pass, so a healthy machine cannot read as failing.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
[ -f "$SETUP" ] || { echo "FAIL: cannot find install/setup.sh at $SETUP" >&2; exit 1; }

# Extract the record function (#4675 moved the block into one function that every stop at the pause calls with its
# own reason): from its opening line to the first closing brace at column 0.
BLOCK="$(awk '/^_kosmos_note_pause_abort\(\) \{/{f=1} f{print} f && /^\}$/{exit}' "$SETUP")"

case "$BLOCK" in
  *'reason=%s'*'"$_abortf"'*) : ;;
  *) echo "FAIL: could not extract the #2055 record function (anchor drift?)" >&2; exit 1 ;;
esac
# The stop it was written for still records under its own reason.
grep -q '^        _kosmos_note_pause_abort board-would-not-pause$' "$SETUP" \
  || { echo "FAIL: the board-would-not-pause stop no longer records itself (anchor drift?)" >&2; exit 1; }

# The reset line, extracted so a change to its path is caught here too.
RESET="$(awk '/#2055: got past the pause/{f=1} f && /rm -f "\$LOG_DIR\/update-abort"/{print; exit}' "$SETUP")"
case "$RESET" in
  *'rm -f "$LOG_DIR/update-abort"'*) : ;;
  *) echo "FAIL: could not extract the #2055 reset line (anchor drift?)" >&2; exit 1 ;;
esac

PASS=0; FAIL=0
TMP="$(mktemp -d "${TMPDIR:-/tmp}/updateabort.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Define the extracted record function and call it once with LOG_DIR/PORT set. It runs under a
# `set -eu` subshell so an errexit-unsafe line is caught.
record() { # logdir port [reason]
  ( set -eu; LOG_DIR="$1"; PORT="$2"; eval "$BLOCK"; _kosmos_note_pause_abort "${3:-board-would-not-pause}" )
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

# ---- #4675: count is the whole streak; same counts back over the latest reason --------------
val() { sed -n "s/^$1=//p" "$2" 2>/dev/null; }
L3="$TMP/logs3"; mkdir -p "$L3"; M3="$L3/update-abort"
record "$L3" 16180
record "$L3" 16180
chk "two stops for one reason: count 2, same 2"       sh -c '[ "$1" = "2 2" ]' _ "$(val count "$M3") $(val same "$M3")"
record "$L3" 16180 port-check-failed
chk "a stop for another reason: the streak goes on (count 3), same restarts at 1" sh -c '[ "$1" = "3 1" ]' _ "$(val count "$M3") $(val same "$M3")"
chk "the reason is the latest stop's"                 sh -c 'grep -q "^reason=port-check-failed$" "$1"' _ "$M3"
chk "only one reason line is kept"                    sh -c '[ "$(grep -c "^reason=" "$1")" = 1 ]' _ "$M3"
record "$L3" 16180 port-check-failed
chk "the same reason again: count 4, same 2"          sh -c '[ "$1" = "4 2" ]' _ "$(val count "$M3") $(val same "$M3")"
record "$L3" 16180
chk "alternating reasons never restart the streak: count 5, same 1" sh -c '[ "$1" = "5 1" ]' _ "$(val count "$M3") $(val same "$M3")"
# A marker written before `same` existed could only hold board-would-not-pause, so for that reason its count is its
# same. For any other reason a missing or damaged same is unknown, and the run of that reason starts at this stop.
L4="$TMP/logs4"; mkdir -p "$L4"; M4="$L4/update-abort"
printf 'count=7\nreason=board-would-not-pause\nport=16180\nts=x\n' > "$M4"
record "$L4" 16180
chk "an older marker with no same line: count 8, same 8" sh -c '[ "$1" = "8 8" ]' _ "$(val count "$M4") $(val same "$M4")"
printf 'count=7\nreason=board-would-not-pause\nport=16180\nts=x\n' > "$M4"
record "$L4" 16180 port-still-held
chk "an older marker, then another reason: count 8, same 1" sh -c '[ "$1" = "8 1" ]' _ "$(val count "$M4") $(val same "$M4")"
printf 'count=3\nreason=port-still-held\nsame=lots\n' > "$M4"
record "$L4" 16180 port-still-held
chk "a damaged same under another reason is not taken as the whole streak: count 4, same 1" sh -c '[ "$1" = "4 1" ]' _ "$(val count "$M4") $(val same "$M4")"
printf 'count=4\nreason=port-still-held\n' > "$M4"
record "$L4" 16180 port-still-held
chk "a missing same under another reason is not taken as the whole streak: count 5, same 1" sh -c '[ "$1" = "5 1" ]' _ "$(val count "$M4") $(val same "$M4")"
# A count or same the shell's arithmetic would refuse must not end the run inside the function (it runs under set -e,
# just before the stop prints its words): it is treated as damaged.
for bad in 08 0099 99999999999999999999; do
  printf 'count=%s\nreason=port-still-held\nsame=1\n' "$bad" > "$M4"
  RC=0; record "$L4" 16180 port-still-held 2>/dev/null || RC=$?
  chk "count=$bad does not end the run (rc 0), and the count restarts: count 1, same 2" sh -c '[ "$1" = "0 1 2" ]' _ "$RC $(val count "$M4") $(val same "$M4")"
  printf 'count=3\nreason=port-still-held\nsame=%s\n' "$bad" > "$M4"
  RC=0; record "$L4" 16180 port-still-held 2>/dev/null || RC=$?
  chk "same=$bad does not end the run (rc 0), and same restarts: count 4, same 1" sh -c '[ "$1" = "0 4 1" ]' _ "$RC $(val count "$M4") $(val same "$M4")"
done
# ---- #4675: setup.sh's own lines that read the board's marker: only the value 1 is the board, and the variable is
# gone from the environment afterwards (the script goes on to start the board, whose agents must not inherit it).
BYBOARD_LINES="$(awk '/^_kosmos_by_board=no$/{f=1} f{print} f && /^unset KOSMOS_UPDATE_BY_BOARD$/{exit}' "$SETUP")"
case "$BYBOARD_LINES" in
  '_kosmos_by_board=no'*'KOSMOS_UPDATE_BY_BOARD'*'unset KOSMOS_UPDATE_BY_BOARD') : ;;
  *) echo "FAIL: could not extract the lines that read KOSMOS_UPDATE_BY_BOARD (anchor drift?)" >&2; exit 1 ;;
esac
byboard() { # the value, or "-" for unset; prints "<flag> <what a child sees>"
  ( set -eu
    if [ "$1" = - ]; then unset KOSMOS_UPDATE_BY_BOARD; else KOSMOS_UPDATE_BY_BOARD="$1"; export KOSMOS_UPDATE_BY_BOARD; fi
    eval "$BYBOARD_LINES"
    printf '%s %s\n' "$_kosmos_by_board" "$(/bin/sh -c 'echo "${KOSMOS_UPDATE_BY_BOARD:-gone}"')" )
}
chk "KOSMOS_UPDATE_BY_BOARD=1 is the board, and is gone for children"      sh -c '[ "$1" = "yes gone" ]' _ "$(byboard 1)"
chk "unset is not the board"                                               sh -c '[ "$1" = "no gone" ]' _ "$(byboard -)"
for v in yes 0 true 11 ""; do
  chk "KOSMOS_UPDATE_BY_BOARD='$v' is not the board, and is gone for children" sh -c '[ "$1" = "no gone" ]' _ "$(byboard "$v")"
done
# ---- a logs dir that cannot be written is not an error (the stop still stops) -
chk "an unwritable logs dir does not fail the caller" record "$TMP/no-such-dir" 16180

# ---- negative control: prove chk can fail -----------------------------------
NEG=0
sh -c '[ "1" = "2" ]' || NEG=1
chk "negative control: a false condition is detected" test "$NEG" = 1

echo "test-update-abort-2055: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
