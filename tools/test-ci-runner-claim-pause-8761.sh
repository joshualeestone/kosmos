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

mkdir -p "$T/bin" "$T/home/actions-runner" "$T/state" "$T/home/Library/LaunchAgents" "$T/daemons" "$T/claims"
LABEL=actions.runner.owner-kosmos.r3
AGENT="$T/home/Library/LaunchAgents/$LABEL.plist"
# As svc.sh writes it: .service names the agent plist, whose WorkingDirectory is the runner dir.
printf '%s\n' "$AGENT" > "$T/home/actions-runner/.service"
cat > "$AGENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>$LABEL</string><key>WorkingDirectory</key><string>$T/home/actions-runner</string></dict></plist>
EOF
# launchctl: `print` shows a pid while $T/running exists; kill and kickstart are logged and change that state.
cat > "$T/bin/launchctl" <<EOF
#!/bin/bash
echo "\$*" >> "$T/calls"
case "\$1" in
  print) case "\$2" in system/*) [ -f "$T/insystem" ] && exit 0; exit 113 ;; esac; [ -f "$T/notloaded" ] && exit 113; echo "$LABEL = {"; [ -f "$T/running" ] && printf '\tpid = 4242\n'
    [ -f "$T/kaalways" ] && printf '\tproperties = keepalive | runatload | inferred program\n'
    [ -f "$T/kasuccess" ] && printf '\tproperties = runatload | inferred program\n\tsemaphores = {\n\t\tsuccessful exit => 0\n\t}\n'
    echo "}" ;;
  kill) [ -f "$T/killfails" ] && exit 1; rm -f "$T/running" ;;
  kickstart) [ -f "$T/kickfails" ] && exit 1; : > "$T/running" ;;
esac
exit 0
EOF
# pgrep: exit 0 (a Runner.Worker) while $T/busy exists, else 1; $T/pgrepbroken makes it exit 3.
cat > "$T/bin/pgrep" <<EOF
#!/bin/bash
echo "\$*" >> "$T/pgrepcalls"
[ -f "$T/pgrepbroken" ] && exit 3
case "\$*" in *" -f "*) [ -f "$T/nolistener" ] && exit 1; exit 0 ;; esac
[ -f "$T/busy" ] && exit 0
exit 1
EOF
chmod +x "$T/bin/launchctl" "$T/bin/pgrep"
NOW=2000000000
CLAIM="$T/claims/machine-claim"
dead_pid() { sh -c 'exit 0' & local p=$!; wait "$p"; echo "$p"; }
DEAD="$(dead_pid)"
tick() {
  : > "$T/calls"
  KOSMOS_CI_CLAIM_FILE="$CLAIM" KOSMOS_CI_RUNNER_DIR="$T/home/actions-runner" KOSMOS_CI_PAUSE_STATE="$T/state" \
  KOSMOS_CI_LAUNCHCTL="$T/bin/launchctl" KOSMOS_CI_PGREP="$T/bin/pgrep" KOSMOS_CI_NOW="$NOW" KOSMOS_CI_UID=501 \
  HOME="$T/home" KOSMOS_CI_DAEMON_DIR="$T/daemons" "$PAUSE" > "$T/out" 2>&1
  echo $? > "$T/rc"
}
rc() { cat "$T/rc"; }
called() { grep -q -- "$1" "$T/calls"; }
: > "$T/pgrepcalls"
reset() { chmod 755 "$T/claims" 2>/dev/null; rm -rf "$CLAIM"; rm -f "$T/nolistener" "$T/insystem" "$T/kaalways" "$T/kasuccess" "$T/daemons/$LABEL.plist" "$T/running" "$T/busy" "$T/notloaded" "$T/killfails" "$T/kickfails" "$T/pgrepbroken" "$T/state/paused-by-claim" "$T/state/claim-cleared-once" "$CLAIM"; : > "$T/running"; }

# Precondition: kill -0 really cannot see pid 1 as this user, so the control below means something.
if kill -0 1 2>/dev/null; then echo "skip test-ci-runner-claim-pause-8761: kill -0 1 succeeds here (running as root?)"; exit 0; fi
/bin/ps -p 1 -o pid= >/dev/null 2>&1 || { fail "precondition: ps cannot see pid 1"; }

# 1. A live claim held by ANOTHER user's live process (pid 1), runner idle: stopped, marker written.
reset; echo "c1 1 $((NOW + 3600)) mortals 0.8.11 cut" > "$CLAIM"; tick
grep -qxF -- "-u 501 -f ^$(printf '%s' "$T/home/actions-runner" | sed 's/[.]/[.]/g')/bin[^/]*/Runner[.]Listener( |\$)" "$T/pgrepcalls" && pass "this runner's Listener is looked for by its argv start (-u 501 -f)" || fail "the Listener lookup was asked: $(tr '\n' ';' < "$T/pgrepcalls")"
grep -qx -- "-u 501 -x Runner.Worker" "$T/pgrepcalls" && pass "a job is looked for as Runner.Worker of this uid (-u 501 -x)" || fail "the process lookup was asked: $(tr '\n' ';' < "$T/pgrepcalls")"
if [ "$(rc)" = 0 ] && called "kill SIGTERM gui/501/$LABEL" && [ -f "$T/state/paused-by-claim" ]; then pass "live claim (another user's pid), idle: stopped with SIGTERM, marker written"; else fail "live claim, idle: rc $(rc), calls: $(tr '\n' ';' < "$T/calls") out: $(cat "$T/out")"; fi
grep -q "0.8.11 cut" "$T/out" && pass "says whose claim it is" || fail "the line names the claim: $(cat "$T/out")"

# 2. Still claimed, already stopped: nothing more.
tick; if [ "$(rc)" = 0 ] && ! called kill && ! called kickstart; then pass "still claimed and stopped: left alone"; else fail "still claimed: $(tr '\n' ';' < "$T/calls")"; fi

[ "$(cat "$T/state/paused-by-claim")" = 4242 ] && pass "the marker holds the pid it stopped" || fail "marker holds: $(cat "$T/state/paused-by-claim")"

# 3. Claim cleared: on the first clear tick, nothing yet; on the second, started again and the marker removed.
rm -f "$CLAIM"; tick
[ "$(rc)" = 0 ] && ! called kickstart && [ -f "$T/state/claim-cleared-once" ] && pass "claim gone once: not started yet" || fail "first clear: rc $(rc) $(tr '\n' ';' < "$T/calls")"
echo "c1 1 $((NOW + 3600)) mortals next phase" > "$CLAIM"; tick
[ ! -f "$T/state/claim-cleared-once" ] && ! called kickstart && pass "claim back between phases: the clear is forgotten, still paused" || fail "re-claim: $(tr '\n' ';' < "$T/calls")"
rm -f "$CLAIM"; tick; tick
if [ "$(rc)" = 0 ] && called "kickstart gui/501/$LABEL" && [ ! -f "$T/state/paused-by-claim" ] && [ -f "$T/running" ]; then pass "claim cleared: kickstarted, marker removed"; else fail "cleared: rc $(rc) $(tr '\n' ';' < "$T/calls")"; fi

# 4. No claim, no marker, runner stopped by hand: never started here.
reset; rm -f "$T/running"; tick
if [ "$(rc)" = 0 ] && ! called kickstart; then pass "stopped by hand, no claim: not started"; else fail "hand stop: $(tr '\n' ';' < "$T/calls")"; fi

# 5. A job running under a live claim: left to finish (no kill), then stopped once idle.
reset; : > "$T/busy"; echo "c1 1 $((NOW + 3600)) mortals cut" > "$CLAIM"; tick
if [ "$(rc)" = 0 ] && ! called kill && [ -f "$T/running" ] && [ ! -f "$T/state/paused-by-claim" ]; then pass "job running: not stopped, no marker written"; else fail "busy: $(tr '\n' ';' < "$T/calls")"; fi
rm -f "$T/busy"; tick; called "kill SIGTERM" && pass "job finished: stopped on the next tick" || fail "after the job: $(tr '\n' ';' < "$T/calls")"

# 6. Claims that must read as NO claim (fail open): each leaves a running runner running.
for c in "expired:c1 1 $((NOW - 1)) mortals cut" "dead holder:c1 $DEAD $((NOW + 3600)) mortals cut" \
         "four fields:c1 1 $((NOW + 3600)) mortals" "pid not a number:c1 x1 $((NOW + 3600)) mortals cut" \
         "expiry not a number:c1 1 soon mortals cut" "empty file:" \
         "two lines:c1 1 $((NOW + 3600)) mortals cut
junk"; do
  reset; printf '%s\n' "${c#*:}" > "$CLAIM"; tick
  if [ "$(rc)" = 0 ] && ! called kill; then pass "no claim ($(printf '%s' "${c%%:*}")): runner left running"; else fail "${c%%:*}: $(tr '\n' ';' < "$T/calls") $(cat "$T/out")"; fi
done
[ -f "$CLAIM" ] && pass "a stale claim file is never removed (it is the holder's)" || fail "the claim file was removed"

# 7. Refusals that must not stop the runner.
reset; : > "$T/pgrepbroken"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 1 ] && ! called kill && pass "pgrep failed: not stopped, exit 1" || fail "pgrep broken: rc $(rc) $(tr '\n' ';' < "$T/calls")"
reset; echo 1111 > "$T/state/paused-by-claim"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 1 ] && ! called kill && pass "running again as a NEW pid after this pause stopped another: not stopped again, exit 1" || fail "restart loop: rc $(rc) $(tr '\n' ';' < "$T/calls")"
reset; echo 4242 > "$T/state/paused-by-claim"; touch -t 202001010000 "$T/state/paused-by-claim"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 0 ] && ! called kill && grep -q "still ending" "$T/out" && pass "the SAME pid still running, however long after the stop: waits, exit 0" || fail "fresh marker: rc $(rc) $(cat "$T/out")"
reset; : > "$T/kaalways"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 1 ] && ! called kill && [ ! -f "$T/state/paused-by-claim" ] && pass "KeepAlive true loaded: not stopped, no marker, exit 1" || fail "keepalive true: rc $(rc) $(cat "$T/out")"
reset; : > "$T/kasuccess"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 0 ] && called "kill SIGTERM" && pass "CONTROL: KeepAlive {SuccessfulExit: false} loaded: stopped" || fail "keepalive success: rc $(rc) $(cat "$T/out")"
reset; : > "$T/nolistener"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 0 ] && ! called kill && [ ! -f "$T/state/paused-by-claim" ] && grep -q "no Listener" "$T/out" && pass "service up but no Listener (restarting or updating): waits, no stop" || fail "no listener: rc $(rc) $(cat "$T/out")"
reset; echo 4242 > "$T/state/paused-by-claim"; touch -t 202001010000 "$T/state/paused-by-claim"; tick
[ "$(rc)" = 0 ] && ! called kickstart && [ -f "$T/state/paused-by-claim" ] && pass "claim cleared while the stopped pid is still ending (long after): no kickstart yet, marker kept" || fail "clear while ending: rc $(rc) $(tr '\n' ';' < "$T/calls")"
reset; echo 1111 > "$T/state/paused-by-claim"; tick
[ "$(rc)" = 0 ] && ! called kickstart && [ ! -f "$T/state/paused-by-claim" ] && pass "claim cleared, runner already running as a new pid: marker dropped, no kickstart" || fail "cleared running: rc $(rc)"
reset; rm -f "$T/running"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 0 ] && ! called kill && [ ! -f "$T/state/paused-by-claim" ] && pass "live claim, stopped by hand, no marker: left alone, no marker written" || fail "hand-stopped under claim: rc $(rc)"
reset; : > "$T/killfails"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 1 ] && [ ! -f "$T/state/paused-by-claim" ] && pass "SIGTERM failed: exit 1, no marker left" || fail "kill fails: rc $(rc)"
reset; rm -f "$CLAIM"; : > "$T/state/paused-by-claim"; : > "$T/state/claim-cleared-once"; rm -f "$T/running"; : > "$T/kickfails"; tick
[ "$(rc)" = 1 ] && [ -f "$T/state/paused-by-claim" ] && pass "kickstart failed: exit 1, marker kept for the next tick" || fail "kick fails: rc $(rc)"
reset; : > "$T/notloaded"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 0 ] && ! called kill && pass "not loaded: nothing to pause" || fail "not loaded: rc $(rc)"

# 6b. A claim this user cannot read: nothing changes (a running runner keeps running, a paused one stays paused), said,
# exit 1.
reset; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; chmod 000 "$CLAIM"; tick; chmod 644 "$CLAIM"
[ "$(rc)" = 1 ] && ! called kill && grep -q "cannot read" "$T/out" && pass "claim file unreadable in a readable folder: nothing changes, said, exit 1" || fail "unreadable file: rc $(rc) $(cat "$T/out")"
reset; mkdir "$CLAIM"; tick
[ "$(rc)" = 1 ] && ! called kill && grep -q "cannot read" "$T/out" && pass "claim path is a folder: not paused, said, exit 1" || fail "claim dir: rc $(rc) $(cat "$T/out")"
reset; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; chmod 000 "$T/claims"; tick; chmod 755 "$T/claims"
[ "$(rc)" = 1 ] && ! called kill && grep -q "cannot read" "$T/out" && pass "claim's folder closed: not paused, said, exit 1" || fail "closed dir: rc $(rc) $(cat "$T/out")"
reset; rm -f "$T/running"; : > "$T/state/paused-by-claim"; chmod 000 "$T/claims"; tick; chmod 755 "$T/claims"
[ "$(rc)" = 1 ] && ! called kickstart && [ -f "$T/state/paused-by-claim" ] && pass "unreadable while paused: NOT started again (the cut may still hold the box), marker kept" || fail "unreadable paused: rc $(rc) $(tr '\n' ';' < "$T/calls")"
reset; tick; [ "$(rc)" = 0 ] && ! grep -q "cannot read" "$T/out" && pass "CONTROL: no claim file in a readable folder is a plain no claim, exit 0" || fail "control: rc $(rc) $(cat "$T/out")"

# 8. Not set up.
KOSMOS_CI_CLAIM_FILE= KOSMOS_CI_RUNNER_DIR="$T/home/actions-runner" "$PAUSE" >/dev/null 2>&1; [ $? = 2 ] && pass "no claim file setting: exit 2" || fail "no setting"
# The daemon stage's real shape: .service still names the agent path, the agent plist is moved away, a daemon plist
# exists and gui/ does not know the label.
reset; mv "$AGENT" "$T/agent.retired"; : > "$T/daemons/$LABEL.plist"; : > "$T/notloaded"; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 1 ] && ! called kill && grep -q LaunchDaemon "$T/out" && pass "a LaunchDaemon runner (daemon plist): refused, exit 1" || fail "daemon: rc $(rc) $(cat "$T/out")"
reset; : > "$T/insystem"; : > "$T/notloaded"; tick
[ "$(rc)" = 1 ] && grep -q LaunchDaemon "$T/out" && pass "a LaunchDaemon runner (loaded in system/): refused" || fail "daemon system: rc $(rc) $(cat "$T/out")"
mv "$T/agent.retired" "$AGENT"
# .service naming another runner's plist (a job can write this home): not followed.
cp "$AGENT" "$T/agent.keep"; sed "s|<string>$T/home/actions-runner</string>|<string>/elsewhere</string>|" "$T/agent.keep" > "$AGENT"
reset; echo "c1 1 $((NOW + 3600)) m cut" > "$CLAIM"; tick
[ "$(rc)" = 2 ] && ! called kill && pass "a plist whose WorkingDirectory is another runner's: not followed, exit 2" || fail "other wd: rc $(rc) $(cat "$T/out")"
cp "$T/agent.keep" "$AGENT"
printf '%s\n' "$T/home/Library/LaunchAgents/com.example.other.plist" > "$T/home/actions-runner/.service"; reset; tick
[ "$(rc)" = 2 ] && pass ".service naming a LaunchAgent that is not actions.runner.*: exit 2" || fail "not a runner plist: rc $(rc)"
printf '%s\n' "$T/elsewhere/$LABEL.plist" > "$T/home/actions-runner/.service"; reset; tick
[ "$(rc)" = 2 ] && pass ".service naming a plist outside this home's LaunchAgents: exit 2" || fail "outside: rc $(rc)"

[ "$fails" = 0 ] && echo "PASS test-ci-runner-claim-pause-8761" || { echo "FAIL test-ci-runner-claim-pause-8761 ($fails)"; exit 1; }
