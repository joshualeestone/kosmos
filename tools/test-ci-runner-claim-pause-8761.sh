#!/usr/bin/env bash
# kosmos#8761: tools/ci-runner-claim-pause.sh stops a kosmos-ci runner between jobs while another user's machine claim
# is live, and starts it again (only if it stopped it) when the claim clears. launchctl and pgrep are stand-ins that
# record what they were asked; ps is the real one, against real pids, because the liveness test is the point: pid 1
# (launchd, owned by root) is a live process of ANOTHER user, where `kill -0` cannot tell alive from dead.
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PAUSE="$HERE/ci-runner-claim-pause.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/test-ci-runner-claim-pause-8761.XXXXXXXXXX")"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

mkdir -p "$T/bin" "$T/home/actions-runner" "$T/state"
LABEL=actions.runner.owner-kosmos.r3
printf '%s\n' "$T/home/Library/LaunchAgents/$LABEL.plist" > "$T/home/actions-runner/.service"
# launchctl: `print` shows a pid while $T/running exists; kill and kickstart are logged and change that state.
cat > "$T/bin/launchctl" <<EOF
#!/bin/bash
echo "\$*" >> "$T/calls"
case "\$1" in
  print) [ -f "$T/notloaded" ] && exit 113; echo "$LABEL = {"; [ -f "$T/running" ] && printf '\tpid = 4242\n'; echo "}" ;;
  kill) [ -f "$T/killfails" ] && exit 1; rm -f "$T/running" ;;
  kickstart) [ -f "$T/kickfails" ] && exit 1; : > "$T/running" ;;
esac
exit 0
EOF
# pgrep: exit 0 (a Runner.Worker) while $T/busy exists, else 1; $T/pgrepbroken makes it exit 3.
cat > "$T/bin/pgrep" <<EOF
#!/bin/bash
[ -f "$T/pgrepbroken" ] && exit 3
[ -f "$T/busy" ] && exit 0
exit 1
EOF
chmod +x "$T/bin/launchctl" "$T/bin/pgrep"
NOW=2000000000
CLAIM="$T/machine-claim"
dead_pid() { sh -c 'exit 0' & local p=$!; wait "$p"; echo "$p"; }
DEAD="$(dead_pid)"
tick() {
  : > "$T/calls"
  KOSMOS_CI_CLAIM_FILE="$CLAIM" KOSMOS_CI_RUNNER_DIR="$T/home/actions-runner" KOSMOS_CI_PAUSE_STATE="$T/state" \
  KOSMOS_CI_LAUNCHCTL="$T/bin/launchctl" KOSMOS_CI_PGREP="$T/bin/pgrep" KOSMOS_CI_NOW="$NOW" KOSMOS_CI_UID=501 \
    "$PAUSE" > "$T/out" 2>&1
  echo $? > "$T/rc"
}
rc() { cat "$T/rc"; }
called() { grep -q -- "$1" "$T/calls"; }
reset() { rm -f "$T/running" "$T/busy" "$T/notloaded" "$T/killfails" "$T/kickfails" "$T/pgrepbroken" "$T/state/paused-by-claim" "$CLAIM"; : > "$T/running"; }

# Precondition: kill -0 really cannot see pid 1 as this user, so the control below means something.
if kill -0 1 2>/dev/null; then echo "skip test-ci-runner-claim-pause-8761: kill -0 1 succeeds here (running as root?)"; exit 0; fi
/bin/ps -p 1 -o pid= >/dev/null 2>&1 || { fail "precondition: ps cannot see pid 1"; }

# 1. A live claim held by ANOTHER user's live process (pid 1), runner idle: stopped, marker written.
reset; echo "c1 1 $((NOW + 3600)) mortals 0.8.11 cut" > "$CLAIM"; tick
if [ "$(rc)" = 0 ] && called "kill SIGTERM gui/501/$LABEL" && [ -f "$T/state/paused-by-claim" ]; then pass "live claim (another user's pid), idle: stopped with SIGTERM, marker written"; else fail "live claim, idle: rc $(rc), calls: $(tr '\n' ';' < "$T/calls") out: $(cat "$T/out")"; fi
grep -q "0.8.11 cut" "$T/out" && pass "says whose claim it is" || fail "the line names the claim: $(cat "$T/out")"

# 2. Still claimed, already stopped: nothing more.
tick; if [ "$(rc)" = 0 ] && ! called kill && ! called kickstart; then pass "still claimed and stopped: left alone"; else fail "still claimed: $(tr '\n' ';' < "$T/calls")"; fi

# 3. Claim cleared: started again, marker removed.
rm -f "$CLAIM"; tick
if [ "$(rc)" = 0 ] && called "kickstart gui/501/$LABEL" && [ ! -f "$T/state/paused-by-claim" ] && [ -f "$T/running" ]; then pass "claim cleared: kickstarted, marker removed"; else fail "cleared: rc $(rc) $(tr '\n' ';' < "$T/calls")"; fi

# 4. No claim, no marker, runner stopped by hand: never started here.
reset; rm -f "$T/running"; tick
if [ "$(rc)" = 0 ] && ! called kickstart; then pass "stopped by hand, no claim: not started"; else fail "hand stop: $(tr '\n' ';' < "$T/calls")"; fi

# 5. A job running under a live claim: left to finish (no kill), then stopped once idle.
reset; : > "$T/busy"; echo "c1 1 $((NOW + 3600)) mortals cut" > "$CLAIM"; tick
if [ "$(rc)" = 0 ] && ! called kill && [ -f "$T/running" ]; then pass "job running: not stopped"; else fail "busy: $(tr '\n' ';' < "$T/calls")"; fi
rm -f "$T/busy"; tick; called "kill SIGTERM" && pass "job finished: stopped on the next tick" || fail "after the job: $(tr '\n' ';' < "$T/calls")"

# 6. Claims that must read as NO claim (fail open): each leaves a running runner running.
for c in "expired:c1 1 $((NOW - 1)) mortals cut" "dead holder:c1 $DEAD $((NOW + 3600)) mortals cut" \
         "four fields:c1 1 $((NOW + 3600)) mortals" "pid not a number:c1 x1 $((NOW + 3600)) mortals cut" \
         "expiry not a number:c1 1 soon mortals cut" "empty file:"; do
  reset; printf '%s\n' "${c#*:}" > "$CLAIM"; tick
  if [ "$(rc)" = 0 ] && ! called kill; then pass "no claim ($(printf '%s' "${c%%:*}")): runner left running"; else fail "${c%%:*}: $(tr '\n' ';' < "$T/calls") $(cat "$T/out")"; fi
done
[ -f "$CLAIM" ] && pass "a stale claim file is never removed (it is the holder's)" || fail "the claim file was removed"

# 7. Refusals that must not stop the runner.
reset; : > "$T/pgrepbroken"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 1 ] && ! called kill && pass "pgrep failed: not stopped, exit 1" || fail "pgrep broken: rc $(rc) $(tr '\n' ';' < "$T/calls")"
reset; : > "$T/state/paused-by-claim"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 1 ] && ! called kill && pass "running again after this pause stopped it: not stopped again, exit 1" || fail "restart loop: rc $(rc) $(tr '\n' ';' < "$T/calls")"
reset; : > "$T/killfails"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 1 ] && [ ! -f "$T/state/paused-by-claim" ] && pass "SIGTERM failed: exit 1, no marker left" || fail "kill fails: rc $(rc)"
reset; rm -f "$CLAIM"; : > "$T/state/paused-by-claim"; rm -f "$T/running"; : > "$T/kickfails"; tick
[ "$(rc)" = 1 ] && [ -f "$T/state/paused-by-claim" ] && pass "kickstart failed: exit 1, marker kept for the next tick" || fail "kick fails: rc $(rc)"
reset; : > "$T/notloaded"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 0 ] && ! called kill && pass "not loaded: nothing to pause" || fail "not loaded: rc $(rc)"

# 8. Not set up.
KOSMOS_CI_CLAIM_FILE= KOSMOS_CI_RUNNER_DIR="$T/home/actions-runner" "$PAUSE" >/dev/null 2>&1; [ $? = 2 ] && pass "no claim file setting: exit 2" || fail "no setting"
printf '/Library/LaunchDaemons/%s.plist\n' "$LABEL" > "$T/home/actions-runner/.service"; reset; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 1 ] && ! called kill && pass "a LaunchDaemon runner: refused" || fail "daemon: rc $(rc)"

[ "$fails" = 0 ] && echo "PASS test-ci-runner-claim-pause-8761" || { echo "FAIL test-ci-runner-claim-pause-8761 ($fails)"; exit 1; }
