#!/bin/bash
# #2955: drive the REAL bin/board-watchdog.sh against a stub `kosmos` CLI and a
# fake KOSMOS_HOME, asserting the gates (deliberate-stop marker, board-login-job
# presence) and the grace / backoff / crash-loop / reboot-reset logic. No real
# sleeps: elapsed time is simulated by pre-writing the state file with aged
# timestamps.
set -u
cd "$(dirname "$0")/.." || exit 1
WD="$PWD/bin/board-watchdog.sh"
fails=0
ok()   { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; fails=1; }

# A throwaway KOSMOS_HOME with a stub CLI and a board login-job plist (so gate 2
# passes by default). The stub answers `status` from a flag file (present =>
# healthy/exit 0) and records every `start` (and marks healthy, as a real
# successful start would).
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
  : > "$h/board.plist"          # the board login job "exists" -> gate 2 passes
  # Stub launchctl for the wedged-port escalation: records kickstart and, like a
  # successful re-run of the login job's `kosmos start`, marks the board healthy.
  cat > "$h/bin/launchctl" <<'LC'
#!/bin/bash
H="$(cd "$(dirname "$0")/.." && pwd)"
echo "$*" >> "$H/.stub-launchctl-calls"
case "$1" in kickstart) : > "$H/.stub-healthy" ;; esac
exit 0
LC
  chmod +x "$h/bin/launchctl"
  printf '%s' "$h"
}
starts() { local h="$1"; [ -f "$h/.stub-start-calls" ] && wc -l < "$h/.stub-start-calls" | tr -d ' ' || echo 0; }
kicks()  { local h="$1"; if [ -f "$h/.stub-launchctl-calls" ]; then grep -c kickstart "$h/.stub-launchctl-calls" 2>/dev/null; else echo 0; fi; }
# $1 home ; passes home + the board plist path as argv, like the installed plist does.
run_wd() { local h="$1"; KOSMOS_WATCHDOG_GRACE=45 KOSMOS_WATCHDOG_THROTTLE=180 KOSMOS_WATCHDOG_MAX_FAILS=5 KOSMOS_WATCHDOG_COOLDOWN=3600 KOSMOS_WATCHDOG_LAUNCHCTL="$h/bin/launchctl" bash "$WD" "$h" "$h/board.plist" >/dev/null 2>&1; }
now() { date +%s; }
# down_since must be AFTER boot or the reboot-reset fires; "100s ago" is safely
# post-boot on any machine that has been up longer than that (the test host has).
recent_down() { echo "$(( $(now) - 100 ))"; }

# The gate tests seed a down streak already PAST grace, so that WITHOUT the gate the
# watchdog would restart here (as tests 6+ show it does). Only the gate keeps it out,
# so the "no start" assertion is contingent on the gate rather than on the harmless
# first-observation branch (which would pass whether the gate exists or not).
# 1. Deliberate-stop marker present -> never starts, even with the board long down.
H="$(new_home)"; : > "$H/board.stopped"
printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\n' "$(recent_down)" > "$H/logs/board-watchdog.state"
run_wd "$H"; [ "$(starts "$H")" = 0 ] && ok "marker present: no start" || bad "marker present: started anyway"; rm -rf "$H"

# 2. Board login job ABSENT (auto-restart off / mid-uninstall) -> stays out, even
#    with the board long down.
H="$(new_home)"; rm -f "$H/board.plist"
printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\n' "$(recent_down)" > "$H/logs/board-watchdog.state"
run_wd "$H"; [ "$(starts "$H")" = 0 ] && ok "no board login job: stays out (settings-gate)" || bad "no board login job: started anyway"; rm -rf "$H"

# 3. Healthy -> no start, down streak + fail count cleared, alert removed.
H="$(new_home)"; : > "$H/.stub-healthy"; : > "$H/logs/board-watchdog.alert"
printf 'down_since=%s\nlast_kickstart=0\nfail_count=3\n' "$(recent_down)" > "$H/logs/board-watchdog.state"
run_wd "$H"
[ "$(starts "$H")" = 0 ] && ok "healthy: no start" || bad "healthy: started anyway"
grep -q '^down_since=$' "$H/logs/board-watchdog.state" && grep -q '^fail_count=0$' "$H/logs/board-watchdog.state" && ok "healthy: down streak + fail count cleared" || bad "healthy: state not cleared"
[ ! -f "$H/logs/board-watchdog.alert" ] && ok "healthy: crash-loop alert cleared" || bad "healthy: alert not cleared"
rm -rf "$H"

# 4. Down, first observation -> no start, down_since recorded.
H="$(new_home)"
run_wd "$H"; [ "$(starts "$H")" = 0 ] && ok "first down: no start" || bad "first down: started too early"
[ -n "$(grep '^down_since=' "$H/logs/board-watchdog.state" | cut -d= -f2)" ] && ok "first down: down_since set" || bad "first down: down_since not set"
rm -rf "$H"

# 5. Down, within grace -> no start.
H="$(new_home)"; printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\n' "$(( $(now) - 10 ))" > "$H/logs/board-watchdog.state"
run_wd "$H"; [ "$(starts "$H")" = 0 ] && ok "within grace: no start" || bad "within grace: started too early"; rm -rf "$H"

# 6. Down, past grace, not throttled -> starts, fail_count increments.
H="$(new_home)"; printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\n' "$(recent_down)" > "$H/logs/board-watchdog.state"
run_wd "$H"
[ "$(starts "$H")" = 1 ] && ok "past grace, unthrottled: started" || bad "past grace, unthrottled: did not start ($(starts "$H"))"
grep -q '^fail_count=1$' "$H/logs/board-watchdog.state" && ok "restart increments fail_count" || bad "fail_count not incremented"
rm -rf "$H"

# 6b. A prior restart did not hold (FAILS>=1), past the (grown) backoff -> escalate
# to `launchctl kickstart -k` for the wedged-port case, NOT a plain `kosmos start`.
H="$(new_home)"; printf 'down_since=%s\nlast_kickstart=%s\nfail_count=2\n' "$(recent_down)" "$(( $(now) - 600 ))" > "$H/logs/board-watchdog.state"
run_wd "$H"
[ "$(kicks "$H")" -ge 1 ] && ok "prior failure: escalates to kickstart -k" || bad "prior failure: did not kickstart ($(kicks "$H"))"
[ "$(starts "$H")" = 0 ] && ok "escalation does not also call kosmos start" || bad "escalation also called kosmos start"
rm -rf "$H"

# 7. Down, past grace, within backoff window -> no start (throttle grows with fails).
H="$(new_home)"; printf 'down_since=%s\nlast_kickstart=%s\nfail_count=1\n' "$(recent_down)" "$(( $(now) - 10 ))" > "$H/logs/board-watchdog.state"
run_wd "$H"; [ "$(starts "$H")" = 0 ] && ok "within backoff: no start" || bad "within backoff: started despite throttle"; rm -rf "$H"

# 8. Crash-loop: fail_count >= MAX_FAILS, recent kickstart -> no start, alert raised.
H="$(new_home)"; printf 'down_since=%s\nlast_kickstart=%s\nfail_count=5\n' "$(recent_down)" "$(( $(now) - 10 ))" > "$H/logs/board-watchdog.state"
run_wd "$H"
[ "$(starts "$H")" = 0 ] && ok "crash-loop past MAX_FAILS: no start" || bad "crash-loop: kept restarting"
[ -f "$H/logs/board-watchdog.alert" ] && ok "crash-loop: alert raised" || bad "crash-loop: no alert raised"
rm -rf "$H"

# 9. Crash-loop cooldown elapsed -> one more burst is allowed (starts again).
H="$(new_home)"; printf 'down_since=%s\nlast_kickstart=%s\nfail_count=5\n' "$(recent_down)" "$(( $(now) - 4000 ))" > "$H/logs/board-watchdog.state"
run_wd "$H"; [ "$(starts "$H")" = 1 ] && ok "crash-loop after cooldown: retries" || bad "crash-loop after cooldown: did not retry ($(starts "$H"))"; rm -rf "$H"

# 10. Reboot reset: down_since predates boot -> streak discarded, no immediate start.
H="$(new_home)"; printf 'down_since=1000000000\nlast_kickstart=1000000000\nfail_count=9\n' > "$H/logs/board-watchdog.state"
run_wd "$H"
[ "$(starts "$H")" = 0 ] && ok "reboot reset: stale streak does not fire immediately" || bad "reboot reset: fired on stale down_since"
grep -q '^fail_count=0$' "$H/logs/board-watchdog.state" && ok "reboot reset: fail count cleared" || bad "reboot reset: fail count not cleared"
rm -rf "$H"

# 11. Non-numeric state does not crash the arithmetic; treated as fresh.
H="$(new_home)"; printf 'down_since=garbage\nlast_kickstart=x\nfail_count=y\n' > "$H/logs/board-watchdog.state"
run_wd "$H"; rc=$?
[ "$rc" = 0 ] && ok "corrupt state: no crash" || bad "corrupt state: nonzero exit $rc"
rm -rf "$H"

# 12. No CLI at all (broken install) -> silent no-op.
H="$(mktemp -d)"; mkdir -p "$H/logs"; : > "$H/board.plist"
run_wd "$H"; rc=$?; [ "$rc" = 0 ] && ok "missing CLI: silent no-op" || bad "missing CLI: nonzero exit $rc"; rm -rf "$H"

# ---- the CLI's marker wiring, against the REAL install/kosmos --------------
CLI="$PWD/install/kosmos"
FREEPORT=39517

# 13. cmd_start clears the marker EARLY -- even when the start then FAILS.
H="$(mktemp -d)"; mkdir -p "$H/logs"; : > "$H/board.stopped"
KOSMOS_HOME="$H" KOSMOS_PORT="$FREEPORT" bash "$CLI" start >/dev/null 2>&1 || true
[ ! -f "$H/board.stopped" ] && ok "cmd_start clears the marker even when start fails" || bad "cmd_start left the marker after a failed start"
rm -rf "$H"

# 14. cmd_stop writes the marker (not-running branch).
H="$(mktemp -d)"; mkdir -p "$H/logs"
KOSMOS_HOME="$H" KOSMOS_PORT="$FREEPORT" bash "$CLI" stop >/dev/null 2>&1 || true
[ -f "$H/board.stopped" ] && ok "cmd_stop writes the deliberate-stop marker" || bad "cmd_stop did not write the marker"
rm -rf "$H"

echo "board-watchdog-2955: $fails failures"; [ "$fails" -eq 0 ]
