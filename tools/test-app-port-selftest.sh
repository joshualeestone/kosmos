#!/bin/bash
# kosmos#955: prove the bounded #910 selftest FAILS a stale bundle instead of hanging,
# and that the bound kills the WHOLE process group (a forked child is reaped, not
# orphaned).
#
# Drives tools/lib/app-port-selftest.sh against stub bundles, so the detection is provable
# without a real macOS bundle. A real control: it asserts detect-current AND detect-behind,
# that bounded_run returns 124 within a generous ceiling (if it ever hung, THIS TEST would hang --
# the #955 regression), and that a FORKED grandchild does not survive the kill -- which a
# naive kill-the-launcher WOULD leak, so this arm reds a regression to launcher-only kill.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tools/lib/app-port-selftest.sh
. "$HERE/lib/app-port-selftest.sh"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/apst-test.XXXXXXXX")"
# On a red run (a real regression) the stub's sleeps would live for years: take this run's
# own, and only this run's (their markers carry $$), on the way out.
trap 'pkill -f "sleep 955[23]$$\$" 2>/dev/null; rm -rf "$tmp"' EXIT
fails=0
T=5                 # the bound for bundles that HANG: short, so a real hang is caught quickly.
                    # 5s, not 2 (#3854 review): a 124 at 5s tests the same thing, and a start
                    # that is slow under load is much less likely to miss the fork, or to be
                    # killed before perl's setpgrp (the bounded_run race filed as #3859).
RERUN_T=10          # one rerun of a hang arm whose stub had not forked by T
QUICK_T=30          # #3854: the bound for bundles that ANSWER. bounded_run polls once a
                    # second, so under a 2s bound perl + bash startup on a loaded Mac (load 7-12)
                    # was killed at 124 about 1 run in 6. A quick answer returns as soon as it
                    # exits, so a generous bound costs nothing when the Mac is idle. Only the
                    # HANGING arms keep T: their 124 is the thing under test.
FORK="9552$$"     # a distinctive sleep the stub FORKS: orphaned by a naive kill, reaped
                    # only by the group-kill -- this is what makes the no-orphan arm real.
                    # $$ makes it unique per run so a CONCURRENT run of this test on the
                    # same fleet box cannot match our marker and false-FAIL the count.
LAUNCH="9553$$"   # the stub's launcher sleep (also unique per run)

check() {  # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS  $1"
  else echo "FAIL  $1 (expected $2, got $3)"; fails=$((fails + 1)); fi
}

# wait_gone <pgrep-pattern>: the group-kill lands asynchronously, so poll (up to ~20s)
# for our (unique) marker to disappear rather than assuming a fixed delay; echo the
# final match count (0 = reaped).
wait_gone() {
  local c=0
  # `$` anchors the pattern to the END of the command line: our marker `sleep 9552<pid>`
  # is a PREFIX of a concurrent run's `sleep 9552<longerpid>`, so an UNanchored match could
  # count another run's live child and false-FAIL. Anchored, only our exact marker matches.
  # Up to ~20s (#3854 review): a reaped marker is gone at the first look, so the longer
  # ceiling costs nothing unless the reap is genuinely slow on a loaded Mac.
  for _ in $(seq 1 40); do
    c="$(pgrep -f "$1\$" | wc -l | tr -d ' ')"
    [ "$c" = 0 ] && break
    sleep 0.5
  done
  echo "$c"
}

# CURRENT: answers the real flag with the pinned uid-501 port and exits; anything else
# starts the "app" and sits there (a #910-aware bundle does not know other flags).
cur="$tmp/current"
cat > "$cur" <<EOF
#!/bin/bash
if [ "\$1" = "--kosmos-app-port-selftest" ] && [ "\$2" = 501 ]; then echo 16180; exit 0; fi
exec sleep $LAUNCH
EOF
chmod +x "$cur"

# BEHIND-HANG: predates the flag, so it starts the app for EVERYTHING (the real bug). It
# FORKS a child before becoming the launcher, so a launcher-only kill would orphan the
# child -- exactly the leak the group-kill exists to prevent.
# It writes the child's PID to FORKED once it has forked (#3854 review): under load the kill
# can land before the fork, and then "no child left" would pass with nothing ever to reap.
# The PID, not the command line, is what the reap check follows: a child killed or orphaned
# before it has exec'd `sleep` has no such command line yet, but it has its PID.
bhang="$tmp/behind-hang"
FORKED="$tmp/forked"
cat > "$bhang" <<EOF
#!/bin/bash
sleep $FORK &
echo \$! > "$FORKED"
exec sleep $LAUNCH
EOF
chmod +x "$bhang"

# BEHIND-EXIT: predates the flag and exits immediately with no port.
bexit="$tmp/behind-exit"; printf '#!/bin/bash\nexit 0\n' > "$bexit"; chmod +x "$bexit"

# FAILING: answers the flag but exits nonzero with its own words. bounded_run must hand
# back THAT rc and stdout, not 124 (Baron Draxum, #3854): passthrough, not a timeout.
failing="$tmp/failing"; printf '#!/bin/bash\necho broke\nexit 3\n' > "$failing"; chmod +x "$failing"
# BEHIND-WRONG: answers the flag but with the WRONG port (a bundle that regressed the value).
bwrong="$tmp/behind-wrong"; printf '#!/bin/bash\necho 9999\nexit 0\n' > "$bwrong"; chmod +x "$bwrong"

# --- bounded_run bounds a hanging bundle AND takes its FORKED child with it --------
# The arm is only a test of the reap if the stub forked before the kill. Under load a
# $T-second bound can land first; then run it once more with a bound the start cannot miss.
hang_arm() {  # hang_arm <bound>: sets rc and elapsed
  rm -f "$FORKED"
  local start; start=$(date +%s)
  bounded_run "$1" "$bhang" --kosmos-app-port-selftest 501 >/dev/null 2>&1; rc=$?
  elapsed=$(( $(date +%s) - start ))
}
hang_arm "$T"
[ -s "$FORKED" ] || { wait_gone "sleep $FORK" >/dev/null; hang_arm "$RERUN_T"; }
check "the hanging stub forked before the kill (so the reap below is real)" yes "$([ -s "$FORKED" ] && echo yes || echo no)"
check "bounded_run returns 124 on a hanging bundle" 124 "$rc"
# The completion itself proves no-hang (a broken bound would hang this test). A generous
# ceiling well under the 999s hang catches a far-too-slow bound without flaking on load.
if [ "$elapsed" -le 60 ]; then check "bounded_run did not hang (bounded)" ok ok
else check "bounded_run did not hang (bounded)" ok "SLOW-${elapsed}s"; fi
# The FORKED child (not the launcher) is the real test: a naive kill "$pid" reaps the
# launcher but ORPHANS this; only kill -- -"$pid" (the group) reaps it. So this arm reds
# a regression back to a launcher-only kill. Poll the child's PID until it is gone.
# Only a child that existed can be reaped: without the marker this line fails too, rather
# than reading PASS for a reap that was never exercised (#3854 review round 2).
pid_gone() {  # pid_gone <pid>: 0 once the process is gone (polls ~20s, like wait_gone)
  for _ in $(seq 1 40); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.5; done
  return 1
}
if [ -s "$FORKED" ]; then
  if pid_gone "$(cat "$FORKED")"; then reaped=0; else reaped=1; fi
else reaped="never-forked"; fi
check "the FORKED child is reaped by the group-kill (not orphaned)" 0 "$reaped"

# --- kosmos#3859: the bound expires BEFORE perl has run setpgrp ----------------------
# The seam holds perl for 4s before setpgrp, so the 2s bound expires while there is no
# group yet. The old kill (group only) found nothing and a bare wait then blocked while
# perl went on to exec the hanging bundle: a hang, not a 124. So this arm runs under its
# own watchdog: if bounded_run is still going after 20s it is killed and reported as a
# hang, rather than hanging this test (which would be the #955 shape all over again).
rcf="$tmp/rc-3859"; rm -f "$rcf"
( KOSMOS_BOUNDED_RUN_SETPGRP_DELAY=4 bounded_run "$T" "$bhang" --kosmos-app-port-selftest 501 >/dev/null 2>&1
  echo "$?" > "$rcf" ) &
wd=$!
for _ in $(seq 1 40); do [ -f "$rcf" ] && break; sleep 0.5; done
if [ -f "$rcf" ]; then
  wait "$wd" 2>/dev/null
  check "bound expiring before setpgrp: returns 124, does not hang (#3859)" 124 "$(cat "$rcf")"
else
  # The regression: tear down what it left (the subshell, perl, and the bundle it
  # exec'd, which carry our unique markers) so the rest of this test still runs.
  pkill -f "sleep $LAUNCH\$" 2>/dev/null; pkill -f "sleep $FORK\$" 2>/dev/null
  kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null
  check "bound expiring before setpgrp: returns 124, does not hang (#3859)" 124 "HUNG-20s"
fi
check "nothing leaked when the bound beat setpgrp (#3859)" 0 "$(wait_gone "sleep $LAUNCH")"

# --- bounded_run returns a quick command's output and rc --------------------------
start=$(date +%s)
out="$(bounded_run "$QUICK_T" "$cur" --kosmos-app-port-selftest 501)"; rc=$?
quick=$(( $(date +%s) - start ))
check "bounded_run returns a quick command's rc" 0 "$rc"
check "bounded_run returns a quick command's stdout" 16180 "$out"
# A quick answer returns when it exits, not at the bound: this is what makes QUICK_T free.
QUICK_CEIL=$((QUICK_T * 2 / 3))   # below QUICK_T, so a bound that is always waited out fails
if [ "$quick" -le "$QUICK_CEIL" ]; then check "a quick answer returns before the bound" ok ok
else check "a quick answer returns before the bound" ok "WAITED-${quick}s"; fi
out="$(bounded_run "$QUICK_T" "$failing" --kosmos-app-port-selftest 501)"; rc=$?
check "bounded_run returns a failing command's own rc and stdout, not 124" "3:broke" "$rc:$out"
# The BEHIND answering bundles really ANSWER (rc 0) rather than time out, so the premise
# arms below fail them for their answer, not for a timeout (#3854 review).
out="$(bounded_run "$QUICK_T" "$bexit" --kosmos-app-port-selftest 501)"; rc=$?
check "a BEHIND (exit) bundle answers, with no port" "0:" "$rc:$out"
out="$(bounded_run "$QUICK_T" "$bwrong" --kosmos-app-port-selftest 501)"; rc=$?
check "a WRONG-port bundle answers, with its wrong port" "0:9999" "$rc:$out"

# --- the premise check: current vs behind -----------------------------------------
kosmos_app_selftest_current "$cur" 16180 "$QUICK_T";    check "a CURRENT bundle is #910-aware" 0 "$?"
kosmos_app_selftest_current "$bhang" 16180 "$T";        check "a BEHIND (hanging) bundle is behind" 1 "$?"
kosmos_app_selftest_current "$bexit" 16180 "$QUICK_T";  check "a BEHIND (exit, no port) bundle is behind" 1 "$?"
kosmos_app_selftest_current "$bwrong" 16180 "$QUICK_T"; check "a bundle answering the WRONG port is behind" 1 "$?"

# The CURRENT premise check exits fast on the real flag (starts no app, forks nothing).
# A backstop across the whole run: no child of ours that reached its `sleep` survives (the
# PID-keyed reap above is the check that does not depend on when a child exec'd).
check "no selftest child leaked across the run" 0 "$(wait_gone "sleep $FORK")"

echo "---"
if [ "$fails" -eq 0 ]; then echo "app-port-selftest: all checks passed"; exit 0; fi
echo "app-port-selftest: $fails FAILED"; exit 1
