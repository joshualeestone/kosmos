#!/bin/bash
# kosmos#6651: an update's pause marker is attributable, and one whose installer is gone (killed, or died under a
# full disk, so its EXIT trap never ran) no longer keeps the board off for good. A person's stop is unchanged.
#
# 1. The stranded test is the SAME in install/kosmos and bin/board-watchdog.sh (compared byte for byte), and it
#    is driven against real processes: a live one (pause stands), a dead pid, and a live pid with another start
#    time (a reused pid). Empty and unrecognised markers are a person's stop.
# 2. install/kosmos's writer and restorer, run as extracted functions.
# 3. The real bin/board-watchdog.sh against a stub CLI (as tools/test-board-watchdog-2955.sh does): a stranded
#    marker is moved aside, logged, and the board comes back; a person's marker still keeps it off.
# 4. The callers: board-run and an agent's start clear a stranded marker before their refusal; setup.sh's
#    update pause passes its own pid and start time.
set -u
cd "$(dirname "$0")/.." || exit 1
REPO="$PWD"
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/test-stopmark-6651.XXXXXXXXXX")"
cleanup() { [ -n "${LIVE:-}" ] && kill "$LIVE" 2>/dev/null; rm -rf "${TMP:?}"; }
trap cleanup EXIT

# Print one shell function's text, from its "name() {" line to the first line that is just "}".
fn() { awk -v n="$2" '$0 ~ "^"n"\\(\\) \\{" { on=1 } on { print } on && /^}$/ { exit }' "$1"; }

CLI_FN="$(fn install/kosmos stop_marker_stranded)"; CLI_TOK="$(fn install/kosmos start_token)"
WD_FN="$(fn bin/board-watchdog.sh stop_marker_stranded)"; WD_TOK="$(fn bin/board-watchdog.sh start_token)"
[ -n "$CLI_FN" ] && [ "$CLI_FN" = "$WD_FN" ] && [ -n "$CLI_TOK" ] && [ "$CLI_TOK" = "$WD_TOK" ] \
  && ok "the stranded test and its start token are the same in the CLI and the watchdog" \
  || bad "the CLI's and the watchdog's stranded test or start token differ (or one is missing)"

# --- 1. the stranded test, on real processes ---------------------------------------------------------------
eval "$CLI_TOK"; eval "$CLI_FN"
KOSMOS_HOME="$TMP"; STOP_MARKER="$TMP/board.stopped"
sleep 300 & LIVE=$!; disown "$LIVE" 2>/dev/null || true
live_start="$(start_token "$LIVE")"
[ -n "$live_start" ] || bad "fixture: no start token for a live process"
( exit 0 ) & DEAD=$!; wait "$DEAD" 2>/dev/null   # a pid that has just ended
verdict() { if stop_marker_stranded; then echo stranded; else echo stands; fi; }

: > "$STOP_MARKER"
[ "$(verdict)" = stands ] && ok "an empty marker (a person's stop) stands" || bad "an empty marker read as stranded"
printf 'install %s %s\n' "$LIVE" "$live_start" > "$STOP_MARKER"
[ "$(verdict)" = stands ] && ok "a running installer's pause stands" || bad "a live installer's pause read as stranded"
printf 'install %s %s\n' "$DEAD" "Mon Oct 19 12:00:00 2026" > "$STOP_MARKER"
[ "$(verdict)" = stranded ] && ok "an installer that is gone: stranded" || bad "a dead installer's pause still stands"
printf 'install %s %s\n' "$LIVE" "Mon Jan  1 00:00:00 2001" > "$STOP_MARKER"
[ "$(verdict)" = stranded ] && ok "a reused pid (another start time): stranded" || bad "a reused pid kept the pause"
for body in 'stopped by me' 'install' 'install abc Mon' "install $DEAD"; do
  printf '%s\n' "$body" > "$STOP_MARKER"
  [ "$(verdict)" = stands ] && ok "an unrecognised marker stands: '$body'" || bad "an unrecognised marker read as stranded: '$body'"
done
rm -f "$STOP_MARKER"
[ "$(verdict)" = stands ] && ok "no marker: nothing stranded" || bad "no marker read as stranded"

# A computer whose mode keeps the board off is never started by a stranded-pause clear (the person may have chosen
# connect during the very run that was killed). Same rule as setup.sh: no mode file runs; else only run or both.
printf 'install %s %s\n' "$DEAD" "Mon Oct 19 12:00:00 2026" > "$STOP_MARKER"
for m in connect "" garbage; do
  printf '%s\n' "$m" > "$KOSMOS_HOME/mode"
  [ "$(verdict)" = stands ] && ok "mode '$m' keeps a stranded pause in place" || bad "mode '$m': a stranded pause would start the board"
done
for m in run both; do
  printf '%s\n' "$m" > "$KOSMOS_HOME/mode"
  [ "$(verdict)" = stranded ] && ok "mode '$m': a stranded pause is cleared" || bad "mode '$m' kept a stranded pause"
done
rm -f "$KOSMOS_HOME/mode"

# The token must not depend on the zone of whoever asks (the watchdog runs under launchd, an install from a shell).
tok_tokyo="$(TZ=Asia/Tokyo start_token "$LIVE")"; tok_chicago="$(TZ=America/Chicago start_token "$LIVE")"
[ "$tok_tokyo" = "$tok_chicago" ] && ok "the start token is the same in any TZ" || bad "start token depends on TZ: '$tok_tokyo' vs '$tok_chicago'"
printf 'install %s %s\n' "$LIVE" "$tok_tokyo" > "$STOP_MARKER"
[ "$(TZ=UTC verdict)" = stands ] && ok "a live pause written in one zone stands when read in another" || bad "a TZ change cleared a live pause"

# A ps that cannot run (a sandbox) prints nothing: that alone must never clear a live pause.
mkdir -p "$TMP/badps"; printf '#!/bin/sh\nexit 126\n' > "$TMP/badps/ps"; chmod +x "$TMP/badps/ps"
printf 'install %s %s\n' "$LIVE" "$live_start" > "$STOP_MARKER"
[ "$(PATH="$TMP/badps:$PATH" verdict)" = stands ] && ok "ps broken, installer alive: the pause stands" || bad "a broken ps cleared a live pause"
printf 'install %s %s\n' "$DEAD" "$live_start" > "$STOP_MARKER"
[ "$(PATH="$TMP/badps:$PATH" verdict)" = stranded ] && ok "ps broken, installer gone (kill says no such process): stranded" || bad "a dead installer was kept because ps was broken"

# --- 2. the writer and the restorer ------------------------------------------------------------------------
eval "$(fn install/kosmos write_stop_marker)"
eval "$(fn install/kosmos restore_stop_marker)"
rm -f "$STOP_MARKER"; KOSMOS_STOP_BY_INSTALL="$LIVE $live_start" write_stop_marker
[ "$(cat "$STOP_MARKER")" = "install $LIVE $live_start" ] && ok "an installer's stop says who it is" || bad "installer marker body: $(cat "$STOP_MARKER")"
: > "$STOP_MARKER"; KOSMOS_STOP_BY_INSTALL="$LIVE $live_start" write_stop_marker
[ -f "$STOP_MARKER" ] && [ ! -s "$STOP_MARKER" ] && ok "an installer's stop never overwrites a marker already there (a person's stop)" || bad "an installer's stop replaced a person's marker: $(cat "$STOP_MARKER")"
rm -f "$STOP_MARKER"; KOSMOS_STOP_BY_INSTALL="" write_stop_marker
[ -f "$STOP_MARKER" ] && [ ! -s "$STOP_MARKER" ] && ok "a person's stop writes the empty marker" || bad "a person's stop wrote: $(cat "$STOP_MARKER" 2>/dev/null)"
rm -f "$STOP_MARKER"; KOSMOS_STOP_BY_INSTALL="not a pid" write_stop_marker
[ -f "$STOP_MARKER" ] && [ ! -s "$STOP_MARKER" ] && ok "a malformed attribution falls back to the empty marker" || bad "malformed attribution wrote: $(cat "$STOP_MARKER" 2>/dev/null)"
restore_stop_marker "install $DEAD Mon Oct 19 12:00:00 2026"
[ "$(cat "$STOP_MARKER")" = "install $DEAD Mon Oct 19 12:00:00 2026" ] && ok "a restore keeps an installer's words" || bad "restore changed the body: $(cat "$STOP_MARKER")"
restore_stop_marker ""
[ ! -s "$STOP_MARKER" ] && ok "a restore of a person's stop is empty again" || bad "a person's restore wrote words"

# --- 3. the real watchdog -----------------------------------------------------------------------------------
new_home() {
  local h; h="$(mktemp -d "$TMP/home.XXXXXX")"; mkdir -p "$h/bin" "$h/logs"
  cat > "$h/bin/kosmos" <<'STUB'
#!/bin/bash
H="$(cd "$(dirname "$0")/.." && pwd)"
case "$1" in
  status) [ -f "$H/.stub-healthy" ] && exit 0; exit 1 ;;
  start)  echo start >> "$H/.stub-start-calls"; : > "$H/.stub-healthy"; exit 0 ;;
  *) exit 0 ;;
esac
STUB
  chmod +x "$h/bin/kosmos"; : > "$h/board.plist"
  printf '#!/bin/bash\nexit 0\n' > "$h/bin/launchctl"; chmod +x "$h/bin/launchctl"
  # A down streak already past grace, so a run that gets past the marker gate starts the board.
  printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\nbusy_since=\n' "$(( $(date +%s) - 100 ))" > "$h/logs/board-watchdog.state"
  printf '%s' "$h"
}
run_wd() { KOSMOS_WATCHDOG_GRACE=45 KOSMOS_WATCHDOG_THROTTLE=180 KOSMOS_WATCHDOG_MAX_FAILS=5 KOSMOS_WATCHDOG_COOLDOWN=3600 \
  KOSMOS_WATCHDOG_LAUNCHCTL="$1/bin/launchctl" bash "$REPO/bin/board-watchdog.sh" "$1" "$1/board.plist" >/dev/null 2>&1; }
starts() { [ -f "$1/.stub-start-calls" ] && wc -l < "$1/.stub-start-calls" | tr -d ' ' || echo 0; }

H="$(new_home)"; printf 'install %s %s\n' "$DEAD" "Mon Oct 19 12:00:00 2026" > "$H/board.stopped"
[ -f "$H/logs/board-watchdog.state" ] || bad "fixture: the state file is not where the watchdog reads it"
run_wd "$H"
aside="$(ls "$H"/board.stopped.stranded.* 2>/dev/null | head -1)"
{ [ ! -e "$H/board.stopped" ] && [ -n "$aside" ] && grep -q 'cleared a stranded update pause' "$H/logs/board-watchdog.log" 2>/dev/null; } \
  && ok "watchdog: a stranded pause is moved aside (kept) and logged" || bad "watchdog left a stranded pause in place"
[ "$(starts "$H")" -ge 1 ] && ok "watchdog: and the board comes back" || bad "watchdog cleared it but did not start the board"

H="$(new_home)"; : > "$H/board.stopped"
run_wd "$H"
{ [ -e "$H/board.stopped" ] && [ "$(starts "$H")" = 0 ]; } && ok "watchdog CONTROL: a person's stop still keeps it off" || bad "watchdog overrode a person's stop"

H="$(new_home)"; printf 'install %s %s\n' "$DEAD" "Mon Oct 19 12:00:00 2026" > "$H/board.stopped"; printf 'connect\n' > "$H/mode"
run_wd "$H"
{ [ -e "$H/board.stopped" ] && [ "$(starts "$H")" = 0 ]; } && ok "watchdog: a connect computer's stranded pause is left alone" || bad "watchdog started a connect computer's board"

H="$(new_home)"; printf 'install %s %s\n' "$LIVE" "$live_start" > "$H/board.stopped"
run_wd "$H"
{ [ -e "$H/board.stopped" ] && [ "$(starts "$H")" = 0 ]; } && ok "watchdog: a running installer's pause is left alone" || bad "watchdog broke a live update's pause"

# --- 4. the callers -----------------------------------------------------------------------------------------
before_refusal() { # $1 function, $2 the refusal line's text: the stranded clear must come first, inside it
  fn install/kosmos "$1" | awk -v r="$2" '/stop_marker_stranded/ && !seen { c=NR } index($0, r) { if (c) print "ok"; exit }'
}
[ "$(before_refusal cmd_board_run 'Kosmos was deliberately stopped; not starting.')" = ok ] \
  && ok "board-run clears a stranded pause before it refuses" || bad "board-run does not check for a stranded pause first"
grep -q 'stop_marker_stranded; then clear_stranded_stop_marker agent-start' install/kosmos \
  && ok "an agent's start clears a stranded pause before the #5450 refusal" || bad "agent start does not check for a stranded pause"
grep -q 'KOSMOS_STOP_BY_INSTALL="${_kosmos_self_start:+$$ $_kosmos_self_start}" "$KOSMOS_HOME/bin/kosmos" stop --force' install/setup.sh \
  && ok "setup.sh's update pause passes its pid and start time" || bad "setup.sh's pause is not attributed"
awk '/if \[ "\$_kosmos_was_running" = yes \]; then/ { w = NR } /KOSMOS_STOP_BY_INSTALL=/ { if (w && NR - w < 12) print "ok"; exit }' install/setup.sh | grep -q ok \
  && ok "setup.sh attributes its pause only when it is pausing a running board" || bad "setup.sh attributes a pause it does not own"
[ "$(grep -c 'KOSMOS_STOP_BY_INSTALL=' install/setup.sh)" = 1 ] \
  && ok "only the update pause is attributed (uninstall and connect stops stay a plain stop)" || bad "more than one stop in setup.sh is attributed"

echo
[ "$fails" -eq 0 ] && echo "test-stopmark-6651: all passed" || { echo "test-stopmark-6651: FAILED"; exit 1; }
