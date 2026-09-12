#!/bin/bash
# #2955: drive the REAL bin/board-watchdog.sh against a stub `kosmos` CLI and a
# fake KOSMOS_HOME, asserting the marker / grace / throttle logic. No real sleeps:
# elapsed time is simulated by pre-writing the state file with aged timestamps.
set -u
cd "$(dirname "$0")/.." || exit 1
WD="$PWD/bin/board-watchdog.sh"
fails=0
ok()   { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; fails=1; }

# A throwaway KOSMOS_HOME with a stub CLI. The stub answers `status` from a flag
# file (present => healthy/exit 0) and records every `start` (and marks healthy,
# as a real successful start would).
new_home() {
  local h; h="$(mktemp -d)"
  mkdir -p "$h/bin" "$h/logs"
  cat > "$h/bin/kosmos" <<'STUB'
#!/bin/bash
H="$(cd "$(dirname "$0")/.." && pwd)"
case "$1" in
  status) [ -f "$H/.stub-healthy" ] && exit 0 || exit 1 ;;
  start)  echo "start" >> "$H/.stub-start-calls"; : > "$H/.stub-healthy"; exit 0 ;;
  *) exit 0 ;;
esac
STUB
  chmod +x "$h/bin/kosmos"
  printf '%s' "$h"
}
starts() { local h="$1"; [ -f "$h/.stub-start-calls" ] && wc -l < "$h/.stub-start-calls" | tr -d ' ' || echo 0; }
run_wd() { local h="$1"; KOSMOS_WATCHDOG_GRACE=45 KOSMOS_WATCHDOG_THROTTLE=180 bash "$WD" "$h" >/dev/null 2>&1; }
now() { date +%s; }

# 1. Deliberate-stop marker present -> never starts, whatever the port says.
H="$(new_home)"; : > "$H/board.stopped"    # down (no .stub-healthy) AND marker set
run_wd "$H"
[ "$(starts "$H")" = 0 ] && ok "marker present: no start" || bad "marker present: started anyway"
rm -rf "$H"

# 2. Healthy -> no start, and any down streak is cleared.
H="$(new_home)"; : > "$H/.stub-healthy"
printf 'down_since=%s\nlast_kickstart=0\n' "$(( $(now) - 999 ))" > "$H/logs/board-watchdog.state"
run_wd "$H"
[ "$(starts "$H")" = 0 ] && ok "healthy: no start" || bad "healthy: started anyway"
grep -q '^down_since=$' "$H/logs/board-watchdog.state" && ok "healthy: down streak cleared" || bad "healthy: down_since not cleared"
rm -rf "$H"

# 3. Down, first observation -> no start yet, down_since recorded (grace begins).
H="$(new_home)"                             # down, no state
run_wd "$H"
[ "$(starts "$H")" = 0 ] && ok "first down: no start" || bad "first down: started too early"
[ -n "$(grep '^down_since=' "$H/logs/board-watchdog.state" | cut -d= -f2)" ] && ok "first down: down_since set" || bad "first down: down_since not set"
rm -rf "$H"

# 4. Down, still within the grace window -> no start (a legit start may be booting).
H="$(new_home)"
printf 'down_since=%s\nlast_kickstart=0\n' "$(( $(now) - 10 ))" > "$H/logs/board-watchdog.state"   # 10s < GRACE 45
run_wd "$H"
[ "$(starts "$H")" = 0 ] && ok "within grace: no start" || bad "within grace: started too early"
rm -rf "$H"

# 5. Down, past grace, not throttled -> starts.
H="$(new_home)"
printf 'down_since=%s\nlast_kickstart=0\n' "$(( $(now) - 100 ))" > "$H/logs/board-watchdog.state"  # 100s > GRACE 45
run_wd "$H"
[ "$(starts "$H")" = 1 ] && ok "past grace, unthrottled: started" || bad "past grace, unthrottled: did not start ($(starts "$H"))"
rm -rf "$H"

# 6. Down, past grace, but throttled (recent kickstart) -> no start.
H="$(new_home)"
printf 'down_since=%s\nlast_kickstart=%s\n' "$(( $(now) - 100 ))" "$(( $(now) - 10 ))" > "$H/logs/board-watchdog.state"  # last kick 10s ago < THROTTLE 180
run_wd "$H"
[ "$(starts "$H")" = 0 ] && ok "throttled: no start" || bad "throttled: started despite throttle"
rm -rf "$H"

# 7. No CLI at all (broken install) -> silent no-op, no crash.
H="$(mktemp -d)"; mkdir -p "$H/logs"
run_wd "$H"; rc=$?
[ "$rc" = 0 ] && ok "missing CLI: silent no-op" || bad "missing CLI: nonzero exit $rc"
rm -rf "$H"

# ---- the CLI's marker wiring, against the REAL install/kosmos --------------
# Isolated with KOSMOS_HOME (all paths + the marker resolve under it) and an
# unused KOSMOS_PORT (so healthy() cannot latch onto a real board that happens
# to be running on this machine's default port during the test).
CLI="$PWD/install/kosmos"
FREEPORT=39517

# 8. cmd_start clears the marker EARLY -- even when the start then FAILS. This is
#    the load-bearing invariant (Baron): a start that fails to bind (the #2955
#    reboot case) must still retire the deliberate-stop intent, or the watchdog
#    stays suppressed forever. We force a guaranteed failure by pointing at a home
#    with no runtime, so cmd_start dies at the NODE check -- AFTER its top-of-
#    function marker clear.
H="$(mktemp -d)"; mkdir -p "$H/logs"; : > "$H/board.stopped"
KOSMOS_HOME="$H" KOSMOS_PORT="$FREEPORT" bash "$CLI" start >/dev/null 2>&1 || true
[ ! -f "$H/board.stopped" ] && ok "cmd_start clears the marker even when start fails" || bad "cmd_start left the marker after a failed start (watchdog would stay suppressed)"
rm -rf "$H"

# 9. cmd_stop writes the marker (the not-running branch: an explicit stop records
#    the intent so the watchdog does not "recover" what the user turned off).
H="$(mktemp -d)"; mkdir -p "$H/logs"
KOSMOS_HOME="$H" KOSMOS_PORT="$FREEPORT" bash "$CLI" stop >/dev/null 2>&1 || true
[ -f "$H/board.stopped" ] && ok "cmd_stop writes the deliberate-stop marker" || bad "cmd_stop did not write the marker"
rm -rf "$H"

echo "board-watchdog-2955: $fails failures"; [ "$fails" -eq 0 ]
