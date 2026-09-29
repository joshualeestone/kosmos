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
  status) [ -f "$H/.stub-healthy" ] && exit 0; [ -f "$H/.stub-busy" ] && exit 4; exit 1 ;;   # 4: #4466 busy
  # #4466: like the real CLI: a start on a BUSY board is a no-op "already running", unless the watchdog
  # passes KOSMOS_RECLAIM_BUSY=1, when the #3079 reclaim frees the port and the board comes back.
  start)  echo "start reclaim=${KOSMOS_RECLAIM_BUSY:-}" >> "$H/.stub-start-calls"; echo "$*" >> "$H/.stub-start-args"
          if [ ! -f "$H/.stub-busy" ] || [ "${KOSMOS_RECLAIM_BUSY:-}" = 1 ]; then : > "$H/.stub-healthy"; fi; exit 0 ;;
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
# #4466: that bound holds for EVERY seeded age, busy_since and down_since alike. A CI runner can be
# minutes old, so a 400 s streak there predates boot: the reset fires, a "restart" arm goes red, and a
# "no restart" arm passes for the wrong reason. Arms that need a longer busy streak shrink
# KOSMOS_WATCHDOG_BUSY_GRACE instead of seeding older state.
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
grep -qx 'start reclaim=' "$H/.stub-start-calls" && ok "CONTROL: a plain down board's start does NOT ask to reclaim" || bad "a plain down start asked to reclaim: $(cat "$H/.stub-start-calls")"
grep -qx 'start --force' "$H/.stub-start-args" && ok "#4466: the watchdog's start passes --force (it is not an agent)" || bad "watchdog start without --force: $(cat "$H/.stub-start-args" 2>/dev/null)"
grep -q '^fail_count=1$' "$H/logs/board-watchdog.state" && ok "restart increments fail_count" || bad "fail_count not incremented"
rm -rf "$H"

# 6e. #4466: BUSY (status exit 4) past GRACE but within BUSY_GRACE -> NO restart. Arm 6 above is the
#     control: the same age of down streak, plain down, does restart.
H="$(new_home)"; : > "$H/.stub-busy"; printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\n' "$(( $(now) - 60 ))" > "$H/logs/board-watchdog.state"
KOSMOS_WATCHDOG_BUSY_GRACE=300 run_wd "$H"
[ "$(starts "$H")" = 0 ] && [ "$(kicks "$H")" = 0 ] && ok "busy 60 s: no restart (busy grace)" || bad "busy 60 s: restarted a busy board ($(starts "$H") starts, $(kicks "$H") kicks)"
rm -rf "$H"
# 6i. #4466: a board ALREADY seen busy (busy_since set), still inside BUSY_GRACE, with a down streak past
#     GRACE: no restart. This is the grace comparison itself; the arms above reach only the first busy
#     reading (no busy_since) or a streak past the grace, so without this one the comparison is untested.
H="$(new_home)"; : > "$H/.stub-busy"; printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\nbusy_since=%s\n' "$(( $(now) - 90 ))" "$(( $(now) - 60 ))" > "$H/logs/board-watchdog.state"
KOSMOS_WATCHDOG_BUSY_GRACE=300 run_wd "$H"
[ "$(starts "$H")" = 0 ] && [ "$(kicks "$H")" = 0 ] && ok "busy 60 s of a 300 s grace, seen before: no restart" || bad "busy inside its grace was restarted ($(starts "$H") starts, $(kicks "$H") kicks)"
rm -rf "$H"
# 6c. #4466: BUSY past BUSY_GRACE -> the first attempt is `kosmos start` with KOSMOS_RECLAIM_BUSY=1,
#     which reaches the #3079 reclaim, so the wedged board comes back on the first attempt.
H="$(new_home)"; : > "$H/.stub-busy"; printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\nbusy_since=%s\n' "$(( $(now) - 80 ))" "$(( $(now) - 80 ))" > "$H/logs/board-watchdog.state"
KOSMOS_WATCHDOG_BUSY_GRACE=30 run_wd "$H"
grep -qx 'start reclaim=1' "$H/.stub-start-calls" && ok "busy past its grace: the start is told it may reclaim a silent holder (KOSMOS_RECLAIM_BUSY=1)" || bad "busy start did not ask to reclaim: $(cat "$H/.stub-start-calls" 2>/dev/null)"
grep -qx 'start --force' "$H/.stub-start-args" && ok "#4466: the busy reclaim start passes --force too" || bad "busy start without --force: $(cat "$H/.stub-start-args" 2>/dev/null)"
[ "$(starts "$H")" = 1 ] && [ "$(kicks "$H")" = 0 ] && [ -f "$H/.stub-healthy" ] && ok "busy past grace: recovered on the first attempt, no kickstart" || bad "busy past grace: $(starts "$H") starts, $(kicks "$H") kicks, healthy=$([ -f "$H/.stub-healthy" ] && echo yes || echo no)"
rm -rf "$H"
# 6d. A reclaim that did not take (fail_count 1) tries the RECLAIM again, not kickstart: kickstart cannot
#     reach a detached holder, and the reclaim kills our listener whoever tracks it. Arm 6b below is the
#     control: a plain-down board with failures does escalate to kickstart.
H="$(new_home)"; : > "$H/.stub-busy"; printf 'down_since=%s\nlast_kickstart=0\nfail_count=1\nbusy_since=%s\n' "$(( $(now) - 90 ))" "$(( $(now) - 90 ))" > "$H/logs/board-watchdog.state"
KOSMOS_WATCHDOG_BUSY_GRACE=30 run_wd "$H"
[ "$(kicks "$H")" = 0 ] && grep -qx 'start reclaim=1' "$H/.stub-start-calls" && ok "busy past grace after a failed reclaim: reclaims again, no kickstart" || bad "busy after a failed reclaim: $(kicks "$H") kicks, starts: $(cat "$H/.stub-start-calls" 2>/dev/null)"
rm -rf "$H"

# 6f. #4466: DOWN for 400 s, then BUSY for the first time (it came back slow). The busy grace starts NOW,
#     so the board that just came back is not reclaimed. 6c is the control: busy for 400 s is reclaimed.
H="$(new_home)"; : > "$H/.stub-busy"; printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\n' "$(( $(now) - 90 ))" > "$H/logs/board-watchdog.state"
KOSMOS_WATCHDOG_BUSY_GRACE=30 run_wd "$H"
[ "$(starts "$H")" = 0 ] && [ "$(kicks "$H")" = 0 ] && ok "down 90 s then busy: no reclaim of a board that just came back" || bad "down then busy: restarted a board that just came back ($(starts "$H") starts, $(kicks "$H") kicks)"
grep -q '^busy_since=[1-9]' "$H/logs/board-watchdog.state" && ok "down then busy: the busy clock starts at the first busy reading" || bad "busy_since not recorded: $(cat "$H/logs/board-watchdog.state")"
rm -rf "$H"
# 6g. #4466: busy, then plainly DOWN: the busy clock stops (busy_since cleared), so a later busy spell
#     gets its own full grace.
H="$(new_home)"; printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\nbusy_since=%s\n' "$(( $(now) - 10 ))" "$(( $(now) - 10 ))" > "$H/logs/board-watchdog.state"
run_wd "$H"
grep -q '^busy_since=$' "$H/logs/board-watchdog.state" && ok "busy then down: busy_since is cleared" || bad "busy then down: busy_since kept: $(cat "$H/logs/board-watchdog.state")"
rm -rf "$H"
# 6h. #4466: busy for a while, then plainly DOWN, with an OLD down_since: a new down streak gets a fresh
#     GRACE (launchd may be relaunching the board), not an instant restart off the old down clock.
H="$(new_home)"; printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\nbusy_since=%s\n' "$(( $(now) - 90 ))" "$(( $(now) - 60 ))" > "$H/logs/board-watchdog.state"
run_wd "$H"
[ "$(starts "$H")" = 0 ] && [ "$(kicks "$H")" = 0 ] && ok "busy then down: no restart on the first down reading" || bad "busy then down: restarted at once (starts $(starts "$H"), kicks $(kicks "$H"))"
_ds="$(sed -n 's/^down_since=//p' "$H/logs/board-watchdog.state")"
[ -n "$_ds" ] && [ "$(( $(now) - _ds ))" -lt 30 ] && ok "busy then down: the down clock restarts" || bad "busy then down: down_since not reset: $(cat "$H/logs/board-watchdog.state")"
rm -rf "$H"
# CONTROL: the same old down_since with NO busy spell restarts, so the arm above measures the transition.
H="$(new_home)"; printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\n' "$(( $(now) - 90 ))" > "$H/logs/board-watchdog.state"
run_wd "$H"
[ "$(( $(starts "$H") + $(kicks "$H") ))" -ge 1 ] && ok "control: a plain long down streak still restarts" || bad "control: a plain long down streak did not restart"
rm -rf "$H"

# 6b. A prior restart did not hold (FAILS>=1), past the (grown) backoff -> escalate
# to `launchctl kickstart -k` for the wedged-port case, NOT a plain `kosmos start`.
H="$(new_home)"; printf 'down_since=%s\nlast_kickstart=%s\nfail_count=2\n' "$(recent_down)" "$(( $(now) - 600 ))" > "$H/logs/board-watchdog.state"
run_wd "$H"
[ "$(kicks "$H")" -ge 1 ] && ok "prior failure: escalates to kickstart -k" || bad "prior failure: did not kickstart ($(kicks "$H"))"
[ "$(starts "$H")" = 0 ] && ok "escalation does not also call kosmos start" || bad "escalation also called kosmos start"
rm -rf "$H"

# 6c. Prior failure but launchctl CANNOT drive the job (kickstart exits non-zero,
#     e.g. the job is not loaded) -> fall back to a plain kosmos start.
H="$(new_home)"; printf '#!/bin/bash\nexit 1\n' > "$H/bin/launchctl"; chmod +x "$H/bin/launchctl"
printf 'down_since=%s\nlast_kickstart=%s\nfail_count=2\n' "$(recent_down)" "$(( $(now) - 600 ))" > "$H/logs/board-watchdog.state"
run_wd "$H"
[ "$(starts "$H")" = 1 ] && ok "escalation falls back to kosmos start when launchctl fails" || bad "escalation fallback did not start ($(starts "$H"))"
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

# 10. Reboot reset: down_since predates boot -> streak discarded, no immediate start,
#     and a pre-reboot crash-loop alert is cleared.
H="$(new_home)"; : > "$H/logs/board-watchdog.alert"
printf 'down_since=1000000000\nlast_kickstart=1000000000\nfail_count=9\n' > "$H/logs/board-watchdog.state"
run_wd "$H"
[ "$(starts "$H")" = 0 ] && ok "reboot reset: stale streak does not fire immediately" || bad "reboot reset: fired on stale down_since"
grep -q '^fail_count=0$' "$H/logs/board-watchdog.state" && ok "reboot reset: fail count cleared" || bad "reboot reset: fail count not cleared"
[ ! -f "$H/logs/board-watchdog.alert" ] && ok "reboot reset: stale alert cleared" || bad "reboot reset: alert not cleared"
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
