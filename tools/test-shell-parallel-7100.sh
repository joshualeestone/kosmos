#!/bin/bash
# test-shell-parallel-7100.sh - #7100: tools/lib/shell-parallel.sh runs test:shell's shards at once, and
# tools/run-tests.sh's KOSMOS_SHELL_PARALLEL switch refuses what it cannot run.
#
# The shard command here is a stub (no real test runs): it writes one line, can wait at a barrier until every shard
# has started (so a serial runner cannot pass the at-once arm), and exits with the status its shard is given.
#
#   bash tools/test-shell-parallel-7100.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/shell-parallel.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/test-shell-parallel-7100.XXXXXXXXXX")"
trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }

# stub <i> <n>: "shard i of n" on stdout. STUB_BARRIER=<dir>: wait (up to 20 s) until all n shards have started.
# STUB_RC_<i>=<status>: exit with it. STUB_SLOW_<i>=<s>: sleep that long first (to finish out of order).
cat > "$T/stub.sh" <<'STUB'
#!/bin/bash
i="$1"; n="$2"
eval "slow=\${STUB_SLOW_$i:-0}"; eval "rc=\${STUB_RC_$i:-0}"
if [ -n "${STUB_BARRIER:-}" ]; then
  : > "$STUB_BARRIER/started-$i"
  k=0; while [ "$(ls "$STUB_BARRIER" | grep -c '^started-')" -lt "$n" ]; do
    k=$((k + 1)); [ "$k" -gt 200 ] && { echo "shard $i of $n: the others never started"; exit 9; }
    sleep 0.1
  done
fi
[ "$slow" = 0 ] || sleep "$slow"
echo "shard $i of $n"
exit "$rc"
STUB
chmod +x "$T/stub.sh"

# 1) all green: status 0, every shard's log in shard order, then the summary line; the pid list is empty after.
mkdir -p "$T/l1" "$T/b1"
STUB_BARRIER="$T/b1" STUB_SLOW_1=1 kosmos_shell_parallel 3 "$T/l1" "$T/stub.sh" > "$T/l1.out"; rc=$?; out=$(cat "$T/l1.out")
want=$(printf 'shard 1 of 3\nshard 2 of 3\nshard 3 of 3')
if [ "$rc" = 0 ] && [ "$(printf '%s\n' "$out" | grep -v '^run-tests: ' | sed -n 1,3p)" = "$want" ] && [ "$(printf '%s\n' "$out" | grep -c '^run-tests: shell shard [123] of 3: status 0, seen ended at')" = 3 ] && printf '%s\n' "$out" | tail -n 1 | grep -q 'ran as 3 shards at once in [0-9]* s; all green' && [ -z "$KOSMOS_SHELL_PARALLEL_PIDS" ]; then
  pass "three green shards: status 0, one ended line each, logs in shard order (shard 1 finished last), all green, no pids left"
else
  bad "green: rc=$rc(0) pids='$KOSMOS_SHELL_PARALLEL_PIDS'('') out=[$out]"
fi

# 2) the shards run AT ONCE: each waits at the barrier for the others, which a one-at-a-time runner never reaches.
if ! printf '%s\n' "$out" | grep -q 'the others never started'; then pass "the three shards ran at once (every one passed the barrier)"
else bad "the shards did not all start together: out=[$out]"; fi

# 3) reds: the status is the FIRST red shard's (2, status 3), and the line names every red shard (2 and 3).
mkdir -p "$T/l3"
STUB_RC_2=3 STUB_RC_3=5 kosmos_shell_parallel 3 "$T/l3" "$T/stub.sh" > "$T/l3.out"; rc=$?; out=$(cat "$T/l3.out")
if [ "$rc" = 3 ] && printf '%s\n' "$out" | tail -n 1 | grep -q 'red: shard 2 3 (#7100)' && printf '%s\n' "$out" | grep -q '^shard 1 of 3$'; then
  pass "two red shards: status 3 (the first red's), names shards 2 and 3, still prints the green one"
else
  bad "reds: rc=$rc(3) out=[$out]"
fi

# 4) one red among many cannot hide: a single red last shard still reds the part.
mkdir -p "$T/l4"
STUB_RC_4=1 kosmos_shell_parallel 4 "$T/l4" "$T/stub.sh" > "$T/l4.out"; rc=$?; out=$(cat "$T/l4.out")
if [ "$rc" = 1 ] && printf '%s\n' "$out" | tail -n 1 | grep -q 'red: shard 4 (#7100)'; then pass "a red last shard reds the part (status 1)"
else bad "last red: rc=$rc(1) out=[$out]"; fi

# 4b) an interruption stops each shard as a whole process group, so the test a shard was running (here a child
# sleep) dies with it, not orphaned to outlive the run. The runner is its own top-level bash, as run-tests.sh is: an
# EXIT trap that calls kosmos_shell_parallel_stop and no TERM trap, so a TERM ends it and the EXIT trap runs. (A ( )
# subshell of this file would not model it: under bash 3.2 a subshell whose parent has an EXIT trap, as this file
# does, runs no EXIT trap of its own on a TERM. Measured.)
cat > "$T/stubkid.sh" <<'STUBKID'
#!/bin/bash
echo "kid of shard $1 is running"
sleep 300 & echo "$!" > "$STUB_KIDS/kid-$1"   # sleep-control-ok: stands in for a test the shard runs; the stop must kill it
wait
STUBKID
chmod +x "$T/stubkid.sh"
cat > "$T/runner.sh" <<'RUNNER'
#!/bin/bash
. "$1"
trap 'kosmos_shell_parallel_stop' EXIT
kosmos_shell_parallel 2 "$2" "$3" > "$2.out"
RUNNER
mkdir -p "$T/l4b" "$T/kids"
STUB_KIDS="$T/kids" /bin/bash "$T/runner.sh" "$HERE/lib/shell-parallel.sh" "$T/l4b" "$T/stubkid.sh" 2> "$T/l4b.err" &
sub=$!
k=0; while [ "$(ls "$T/kids" | grep -c '^kid-')" -lt 2 ] && [ "$k" -lt 300 ]; do sleep 0.1; k=$((k + 1)); done
kill -TERM "$sub" 2>/dev/null; wait "$sub" 2>/dev/null
alive=0; for f in "$T/kids"/kid-*; do kp=$(cat "$f"); k=0; while kill -0 "$kp" 2>/dev/null && [ "$k" -lt 50 ]; do sleep 0.1; k=$((k + 1)); done; kill -0 "$kp" 2>/dev/null && { alive=$((alive + 1)); kill "$kp" 2>/dev/null; }; done
if [ "$(ls "$T/kids" | grep -c '^kid-')" = 2 ] && [ "$alive" = 0 ]; then pass "a TERM stops both shards' running tests (no orphan outlives the run)"
else bad "interruption: kids recorded $(ls "$T/kids" | grep -c '^kid-')(2), still alive after the stop: $alive(0)"; fi
# ... and the end of each shard's log reached stderr before the logs could be removed.
if grep -q 'interrupted; the last lines of shard-1.log' "$T/l4b.err" && grep -q '^kid of shard 2 is running$' "$T/l4b.err"; then
  pass "an interruption prints the end of each shard's log to stderr"
else
  bad "interruption: shard log tails not on stderr: $(head -c 300 "$T/l4b.err")"
fi

# 4f) a KILL to the runner runs no trap, so nothing in it can stop the shards: each shard's supervisor sees its runner
# gone and stops its own group, the test it was running included (Mortals 2026-10-25: a validation stopped by group
# left three shards running beside a release cut).
mkdir -p "$T/l4f" "$T/kids4f"
STUB_KIDS="$T/kids4f" /bin/bash "$T/runner.sh" "$HERE/lib/shell-parallel.sh" "$T/l4f" "$T/stubkid.sh" 2>/dev/null &
sub=$!
k=0; while [ "$(ls "$T/kids4f" | grep -c '^kid-')" -lt 2 ] && [ "$k" -lt 300 ]; do sleep 0.1; k=$((k + 1)); done
kill -KILL "$sub" 2>/dev/null; wait "$sub" 2>/dev/null
alive=0; for f in "$T/kids4f"/kid-*; do kp=$(cat "$f"); k=0; while kill -0 "$kp" 2>/dev/null && [ "$k" -lt 80 ]; do sleep 0.1; k=$((k + 1)); done; kill -0 "$kp" 2>/dev/null && { alive=$((alive + 1)); kill "$kp" 2>/dev/null; }; done
if [ "$(ls "$T/kids4f" | grep -c '^kid-')" = 2 ] && [ "$alive" = 0 ]; then pass "a KILL to the runner still stops both shards' running tests within 8 s"
else bad "runner KILLed: kids recorded $(ls "$T/kids4f" | grep -c '^kid-')(2), still alive 8 s later: $alive(0)"; fi

# 4g) a TERM to one supervisor's own pid (not its group) is passed on to its group: that shard's test stops, and the
# other shard's does not.
mkdir -p "$T/l4g" "$T/kids4g"
STUB_KIDS="$T/kids4g" /bin/bash "$T/runner.sh" "$HERE/lib/shell-parallel.sh" "$T/l4g" "$T/stubkid.sh" 2>/dev/null &
sub=$!
k=0; while [ "$(ls "$T/kids4g" | grep -c '^kid-')" -lt 2 ] && [ "$k" -lt 300 ]; do sleep 0.1; k=$((k + 1)); done
sup1=""; for c in $(pgrep -P "$sub"); do case "$(ps -o command= -p "$c")" in *" 1 2") sup1=$c ;; esac; done
k1=$(cat "$T/kids4g/kid-1" 2>/dev/null); k2=$(cat "$T/kids4g/kid-2" 2>/dev/null)
[ -n "$sup1" ] && kill -TERM "$sup1" 2>/dev/null
k=0; while [ -n "$k1" ] && kill -0 "$k1" 2>/dev/null && [ "$k" -lt 80 ]; do sleep 0.1; k=$((k + 1)); done
g_dead1=yes; [ -n "$k1" ] && kill -0 "$k1" 2>/dev/null && g_dead1=no
g_alive2=no; [ -n "$k2" ] && kill -0 "$k2" 2>/dev/null && g_alive2=yes
kill -TERM "$sub" 2>/dev/null; wait "$sub" 2>/dev/null
for kp in $k1 $k2; do kill "$kp" 2>/dev/null; done
if [ -n "$sup1" ] && [ "$g_dead1" = yes ] && [ "$g_alive2" = yes ]; then pass "a TERM to one supervisor alone stops that shard's test and no other"
else bad "TERM to supervisor: found=[${sup1:-none}] its test gone=$g_dead1(yes) other test still running=$g_alive2(yes)"; fi

# 4h) a runner already gone when its supervisor starts (the pid the shell passed is dead): the supervisor stops its
# shard at once instead of waiting on a parent it never had.
sleep 0 & dead=$!; wait "$dead"
mkdir -p "$T/kids4h"
STUB_KIDS="$T/kids4h" perl -e "$_KOSMOS_SHARD_SUPERVISOR" "$dead" "$T/stubkid.sh" 1 1 > /dev/null 2>&1 &
sv=$!
disown "$sv" 2>/dev/null   # no job line in the output when its group is KILLed
# Judged on two things, so it cannot pass vacuously: the supervisor itself has ended (a group that does not exist
# YET reads as empty), and its whole process group, which holds the shard's command and anything it started, is empty.
k=0; while { kill -0 "$sv" 2>/dev/null || kill -0 -- "-$sv" 2>/dev/null; } && [ "$k" -lt 60 ]; do sleep 0.1; k=$((k + 1)); done
h_sv=gone; kill -0 "$sv" 2>/dev/null && h_sv=running
h_grp=empty; kill -0 -- "-$sv" 2>/dev/null && h_grp=occupied
[ "$h_sv$h_grp" = goneempty ] || kill -KILL -- "-$sv" 2>/dev/null
wait "$sv" 2>/dev/null
if [ "$h_sv" = gone ] && [ "$h_grp" = empty ]; then pass "a supervisor whose runner is already gone stops, with its shard's group empty, within 6 s"
else bad "dead runner at start after 6 s: supervisor $h_sv(gone), its group $h_grp(empty)"; fi

# 4i) a TERM passed on to a shard whose test ignores it is followed by a KILL of the group: the supervisor does not
# wait on a stubborn test for as long as its runner lives.
cat > "$T/stubborn4i.sh" <<'STUBBORN4I'
#!/bin/bash
trap '' TERM
sleep 300 & echo "$!" > "$STUB_KIDS/kid-$1"   # sleep-control-ok: stands in for a test the shard runs; the stop must kill it
wait
STUBBORN4I
chmod +x "$T/stubborn4i.sh"
mkdir -p "$T/kids4i"
# The runner is this shell, which is the supervisor's parent and stays alive, so only the TERM can stop the shard.
me4i=$(exec sh -c 'echo $PPID')
STUB_KIDS="$T/kids4i" perl -e "$_KOSMOS_SHARD_SUPERVISOR" "$me4i" "$T/stubborn4i.sh" 1 1 > /dev/null 2>&1 &
sv=$!
disown "$sv" 2>/dev/null
k=0; while [ ! -s "$T/kids4i/kid-1" ] && [ "$k" -lt 100 ]; do sleep 0.1; k=$((k + 1)); done
kill -TERM "$sv" 2>/dev/null
k=0; while kill -0 -- "-$sv" 2>/dev/null && [ "$k" -lt 60 ]; do sleep 0.1; k=$((k + 1)); done
i_grp=empty; kill -0 -- "-$sv" 2>/dev/null && { i_grp=occupied; kill -KILL -- "-$sv" 2>/dev/null; }
wait "$sv" 2>/dev/null
if [ -s "$T/kids4i/kid-1" ] && [ "$i_grp" = empty ]; then pass "a TERM to a supervisor whose test ignores it ends in a KILL of the group within 6 s"
else bad "stubborn shard after a TERM: test recorded=$([ -s "$T/kids4i/kid-1" ] && echo yes || echo no)(yes), group $i_grp(empty)"; fi

# 4j) a KILL to the runner where the shard's command dies on the TERM but a child of it ignores TERM: the supervisor
# does not leave with its command, it KILLs the group, so the child does not outlive the shard.
cat > "$T/ignoreterm.sh" <<'IGNORETERM'
#!/bin/bash
trap '' TERM
exec sleep 300   # sleep-control-ok: stands in for a test's child that ignores TERM; the supervisor must KILL it
IGNORETERM
chmod +x "$T/ignoreterm.sh"
cat > "$T/stubleaver.sh" <<'STUBLEAVER'
#!/bin/bash
"$STUB_IGN" & echo "$!" > "$STUB_KIDS/kid-$1"
wait
STUBLEAVER
chmod +x "$T/stubleaver.sh"
mkdir -p "$T/l4j" "$T/kids4j"
STUB_IGN="$T/ignoreterm.sh" STUB_KIDS="$T/kids4j" /bin/bash "$T/runner.sh" "$HERE/lib/shell-parallel.sh" "$T/l4j" "$T/stubleaver.sh" 2>/dev/null &
sub=$!
k=0; while [ "$(ls "$T/kids4j" | grep -c '^kid-')" -lt 2 ] && [ "$k" -lt 300 ]; do sleep 0.1; k=$((k + 1)); done
kill -KILL "$sub" 2>/dev/null; wait "$sub" 2>/dev/null
alive=0; for f in "$T/kids4j"/kid-*; do kp=$(cat "$f"); k=0; while kill -0 "$kp" 2>/dev/null && [ "$k" -lt 80 ]; do sleep 0.1; k=$((k + 1)); done; kill -0 "$kp" 2>/dev/null && { alive=$((alive + 1)); kill -KILL "$kp" 2>/dev/null; }; done
if [ "$(ls "$T/kids4j" | grep -c '^kid-')" = 2 ] && [ "$alive" = 0 ]; then pass "a KILLed runner's shards KILL a child that ignored the TERM, within 8 s"
else bad "runner KILLed, TERM-ignoring child: kids recorded $(ls "$T/kids4j" | grep -c '^kid-')(2), still alive 8 s later: $alive(0)"; fi

# 4k) the shard's command inherits the signal handling it would have had without the supervisor: a job started with
# & in a non-interactive shell ignores INT, and the supervisor passes that on rather than resetting it.
cat > "$T/sigstub.sh" <<'SIGSTUB'
#!/bin/bash
exec perl -e 'print "INT=", (defined $SIG{INT} ? $SIG{INT} : "undef"), "\n"'
SIGSTUB
chmod +x "$T/sigstub.sh"
mkdir -p "$T/l4k"
kosmos_shell_parallel 1 "$T/l4k" "$T/sigstub.sh" > "$T/l4k.out" 2>&1
if grep -q '^INT=IGNORE$' "$T/l4k.out"; then pass "a shard's command inherits an ignored INT, as before the supervisor"
else bad "inherited INT: $(grep '^INT=' "$T/l4k.out" | head -1)(INT=IGNORE)"; fi

# 4d) a test that ignores TERM (here a sleep under trap '' TERM) is KILLed after the stop's grace, not left running.
cat > "$T/stubborn.sh" <<'STUBBORN'
#!/bin/bash
trap '' TERM
sleep 300 & echo "$!" > "$STUB_KIDS/kid-$1"   # sleep-control-ok: stands in for a test the shard runs; the stop must kill it
wait
STUBBORN
chmod +x "$T/stubborn.sh"
mkdir -p "$T/l4d" "$T/kids4d"
STUB_KIDS="$T/kids4d" /bin/bash "$T/runner.sh" "$HERE/lib/shell-parallel.sh" "$T/l4d" "$T/stubborn.sh" 2>/dev/null &
sub=$!
k=0; while [ "$(ls "$T/kids4d" | grep -c '^kid-')" -lt 2 ] && [ "$k" -lt 300 ]; do sleep 0.1; k=$((k + 1)); done
kill -TERM "$sub" 2>/dev/null; wait "$sub" 2>/dev/null
alive=0; for f in "$T/kids4d"/kid-*; do kp=$(cat "$f"); k=0; while kill -0 "$kp" 2>/dev/null && [ "$k" -lt 50 ]; do sleep 0.1; k=$((k + 1)); done; kill -0 "$kp" 2>/dev/null && { alive=$((alive + 1)); kill -KILL "$kp" 2>/dev/null; }; done
if [ "$(ls "$T/kids4d" | grep -c '^kid-')" = 2 ] && [ "$alive" = 0 ]; then pass "a test that ignores TERM is KILLed after the grace"
else bad "stubborn: kids recorded $(ls "$T/kids4d" | grep -c '^kid-')(2), still alive after the stop: $alive(0)"; fi

# 4c) a shard already waited on can leave something running in its group (a backgrounded server, a sleep). The stop
# reaches it too: shard 1 leaves a sleep and ends at once, shard 2 is still running when the TERM comes.
cat > "$T/stubleft.sh" <<'STUBLEFT'
#!/bin/bash
sleep 300 & echo "$!" > "$STUB_KIDS/kid-$1"   # sleep-control-ok: stands in for a test the shard runs; the stop must kill it
[ "$1" = 1 ] && exit 0
wait
STUBLEFT
chmod +x "$T/stubleft.sh"
mkdir -p "$T/l4c" "$T/kids4c"
STUB_KIDS="$T/kids4c" /bin/bash "$T/runner.sh" "$HERE/lib/shell-parallel.sh" "$T/l4c" "$T/stubleft.sh" 2> "$T/l4c.err" &
sub=$!
k=0; while [ "$(ls "$T/kids4c" | grep -c '^kid-')" -lt 2 ] && [ "$k" -lt 300 ]; do sleep 0.1; k=$((k + 1)); done
# Until shard 1 has been waited on (its status line), so the stop meets it in the waited-on list.
k=0; while ! grep -q 'shell shard 1 of 2: status' "$T/l4c.out" 2>/dev/null && [ "$k" -lt 300 ]; do sleep 0.1; k=$((k + 1)); done
kill -TERM "$sub" 2>/dev/null; wait "$sub" 2>/dev/null
alive=0; for f in "$T/kids4c"/kid-*; do kp=$(cat "$f"); k=0; while kill -0 "$kp" 2>/dev/null && [ "$k" -lt 50 ]; do sleep 0.1; k=$((k + 1)); done; kill -0 "$kp" 2>/dev/null && { alive=$((alive + 1)); kill "$kp" 2>/dev/null; }; done
if [ "$(ls "$T/kids4c" | grep -c '^kid-')" = 2 ] && [ "$alive" = 0 ]; then pass "a TERM also stops what a finished shard left running in its group"
else bad "finished shard's leftover: kids recorded $(ls "$T/kids4c" | grep -c '^kid-')(2), still alive after the stop: $alive(0)"; fi

# 4e) a shard that has ENDED but is not yet waited on (shards are waited on in order, and shard 1 is still running)
# can have left something in its group. Its pid has no process by then, so the stop finds it by its group.
cat > "$T/stubunwaited.sh" <<'STUBUNWAITED'
#!/bin/bash
sleep 300 & echo "$!" > "$STUB_KIDS/kid-$1"   # sleep-control-ok: stands in for a test the shard runs; the stop must kill it
[ "$1" = 2 ] && { : > "$STUB_KIDS/ended-$1"; exit 0; }
wait
STUBUNWAITED
chmod +x "$T/stubunwaited.sh"
mkdir -p "$T/l4e" "$T/kids4e"
STUB_KIDS="$T/kids4e" /bin/bash "$T/runner.sh" "$HERE/lib/shell-parallel.sh" "$T/l4e" "$T/stubunwaited.sh" 2>/dev/null &
sub=$!
k=0; while { [ "$(ls "$T/kids4e" | grep -c '^kid-')" -lt 2 ] || [ ! -e "$T/kids4e/ended-2" ]; } && [ "$k" -lt 300 ]; do sleep 0.1; k=$((k + 1)); done
sleep 0.5   # shard 2's leader exits right after writing its marker
kill -TERM "$sub" 2>/dev/null; wait "$sub" 2>/dev/null
alive=0; for f in "$T/kids4e"/kid-*; do kp=$(cat "$f"); k=0; while kill -0 "$kp" 2>/dev/null && [ "$k" -lt 50 ]; do sleep 0.1; k=$((k + 1)); done; kill -0 "$kp" 2>/dev/null && { alive=$((alive + 1)); kill -KILL "$kp" 2>/dev/null; }; done
if [ "$(ls "$T/kids4e" | grep -c '^kid-')" = 2 ] && [ "$alive" = 0 ]; then pass "a TERM stops what an ended, not-yet-waited-on shard left in its group"
else bad "unwaited shard's leftover: kids recorded $(ls "$T/kids4e" | grep -c '^kid-')(2), still alive after the stop: $alive(0)"; fi

# 5) run-tests.sh refuses a value it cannot run, before running anything: exit 2 and a line naming the variable.
# These start the real run-tests.sh, so they rely on its validation coming before the queue wait and the node part;
# the 60 s group kill below bounds the cost if that ever moves.
# Each arm's run-tests.sh leads a process group of its own under a small perl parent, and at 60 s the parent TERMs
# the whole group: a refusal that failed would start the suite, and costs that run and a red here, not its children
# left running.
GROUP60='$SIG{ALRM} = sub { $SIG{TERM} = "IGNORE"; kill "TERM", -$$; exit 124 }; setpgrp(0, 0); my $p = fork;
  die "fork: $!" unless defined $p; if (!$p) { exec @ARGV or exit 127 } alarm 60; waitpid($p, 0);
  exit(($? & 127) ? 128 + ($? & 127) : $? >> 8)'
rt() {  # <env assignments...>: run tools/run-tests.sh with them; sets RT_RC and RT_OUT
  RT_OUT=$(env -u KOSMOS_SHELL_SHARD -u KOSMOS_SHELL_PLATFORM -u KOSMOS_SHELL_CUT_ENV -u KOSMOS_SHELL_PARALLEL -u KOSMOS_TEST_PART -u KOSMOS_TEST_PART_LOCAL "$@" KOSMOS_TEST_PART=shell KOSMOS_TEST_PART_LOCAL=1 perl -e "$GROUP60" /bin/bash "$HERE/run-tests.sh" 2>&1 < /dev/null); RT_RC=$?
}
for v in 9 0 abc 1x; do
  rt KOSMOS_SHELL_PARALLEL="$v"
  if [ "$RT_RC" = 2 ] && printf '%s' "$RT_OUT" | grep -q "KOSMOS_SHELL_PARALLEL must be a whole number from 1 to 8 (got '$v')"; then
    pass "run-tests refuses KOSMOS_SHELL_PARALLEL=$v (exit 2)"
  else
    bad "run-tests KOSMOS_SHELL_PARALLEL=$v: rc=$RT_RC(2) out=$(printf '%s' "$RT_OUT" | head -c 300)"
  fi
done
rt KOSMOS_SHELL_PARALLEL=2 KOSMOS_SHELL_CUT_ENV=1
if [ "$RT_RC" = 2 ] && printf '%s' "$RT_OUT" | grep -q "KOSMOS_SHELL_PARALLEL and KOSMOS_SHELL_CUT_ENV=1 do not combine"; then
  pass "run-tests refuses KOSMOS_SHELL_PARALLEL with KOSMOS_SHELL_CUT_ENV=1 (exit 2)"
else
  bad "run-tests parallel+cut-env: rc=$RT_RC(2) out=$(printf '%s' "$RT_OUT" | head -c 300)"
fi
# 8, the top of the range, is accepted: it reaches the combination refusal, not the range one.
rt KOSMOS_SHELL_PARALLEL=8 KOSMOS_SHELL_SHARD=1/2
if [ "$RT_RC" = 2 ] && printf '%s' "$RT_OUT" | grep -q "KOSMOS_SHELL_PARALLEL and KOSMOS_SHELL_SHARD do not combine (got parallel '8'"; then
  pass "run-tests accepts KOSMOS_SHELL_PARALLEL=8 (it reaches the combination refusal)"
else
  bad "run-tests KOSMOS_SHELL_PARALLEL=8: rc=$RT_RC(2) out=$(printf '%s' "$RT_OUT" | head -c 300)"
fi
rt KOSMOS_SHELL_PARALLEL=2 KOSMOS_SHELL_SHARD=1/2
if [ "$RT_RC" = 2 ] && printf '%s' "$RT_OUT" | grep -q "KOSMOS_SHELL_PARALLEL and KOSMOS_SHELL_SHARD do not combine"; then
  pass "run-tests refuses KOSMOS_SHELL_PARALLEL with KOSMOS_SHELL_SHARD (exit 2)"
else
  bad "run-tests parallel+shard: rc=$RT_RC(2) out=$(printf '%s' "$RT_OUT" | head -c 300)"
fi

# 6) run-tests.sh carries the verdict out (a TRIPWIRE on the source, not a run: the suite is too big to run here).
# The line after the shell part's `fi` is `NODE_STATUS=$?`, so the parallel branch must END with a command whose
# status is the verdict: `(exit 2)` on its refusal path, `(exit "$_rt_ps_rc")` after the shards. A line added
# after either would turn a red part green.
blk=$(awk '/^  elif \[ "\$_RT_SHELL_PARALLEL" != 1 \]; then$/{on=1} on{print} on && /^  else$/{exit}' "$HERE/run-tests.sh")
last_run=$(printf '%s\n' "$blk" | grep -v '^ *#' | grep -v '^ *$' | sed -n '$!p' | tail -n 2 | head -n 1)
refuse=$(printf '%s\n' "$blk" | grep -B0 -A1 'refusing rather than run them unlogged' | tail -n 1)
after=$(awk '/^    \$\{_rt_shell_wrap\[@\]\+"\$\{_rt_shell_wrap\[@\]\}"\} node "\$REPO\/tools\/shell-shard\.js" run 1 1$/{getline; f=$0; getline; print f "|" $0; exit}' "$HERE/run-tests.sh")
want_after="  fi|  NODE_STATUS=\$"'?'   # assembled, so this line holds no literal dollar-question pair
if printf '%s' "$last_run" | grep -q '^ *(exit "\$_rt_ps_rc")' && printf '%s' "$refuse" | grep -q '^ *(exit 2)' && [ "$after" = "$want_after" ]; then
  pass "run-tests.sh: the parallel branch ends on its verdict on both paths, and the status read follows the fi"
else
  bad "run-tests.sh verdict shape: last=[$last_run] refuse=[$refuse] after=[$after]"
fi

# 7) the switch is this run's alone (a TRIPWIRE on the source): once validated it is kept privately and 1 is
# exported for everything the run starts, so a test that starts run-tests.sh itself runs one at a time. The boundary
# is that line itself, found by its number; nothing after it may read or set the switch (comments do not count).
# Arm 9 checks the same thing by behaviour: every shard sees KOSMOS_SHELL_PARALLEL=1.
pin_at=$(grep -n -x '_RT_SHELL_PARALLEL="\$KOSMOS_SHELL_PARALLEL"; export KOSMOS_SHELL_PARALLEL=1' "$HERE/run-tests.sh" | cut -d: -f1)
later=""
[ -n "$pin_at" ] && later=$(grep -n 'KOSMOS_SHELL_PARALLEL' "$HERE/run-tests.sh" | grep -v '^[0-9]*:[[:space:]]*#' | awk -F: -v u="$pin_at" '$1 > u')
if [ -n "$pin_at" ] && [ -z "$later" ]; then
  pass "run-tests.sh: the switch is kept privately, 1 is exported for what the run starts, and nothing after reads it"
else
  bad "run-tests.sh: KOSMOS_SHELL_PARALLEL pinned at line '${pin_at:-none}', read after it: $(printf '%s' "$later" | head -3)"
fi

# 8) the unset default (kosmos_shell_parallel_default): 4 on a plain local run, 1 in CI, a CI shard or platform share,
# and the cut-env shape. Each case runs in a child with every input scrubbed first, so this file gives the same
# answers under a CI shard's own environment.
printf '. "$1"\nkosmos_shell_parallel_default\n' > "$T/default.sh"
dflt() { env -u GITHUB_ACTIONS -u CI -u KOSMOS_SHELL_SHARD -u KOSMOS_SHELL_PLATFORM -u KOSMOS_SHELL_CUT_ENV "$@" /bin/bash "$T/default.sh" "$HERE/lib/shell-parallel.sh"; }
d_plain=$(dflt); d_gha=$(dflt GITHUB_ACTIONS=true); d_gha_no=$(dflt GITHUB_ACTIONS=false); d_shard=$(dflt KOSMOS_SHELL_SHARD=1/2)
d_plat=$(dflt KOSMOS_SHELL_PLATFORM=linux); d_cut=$(dflt KOSMOS_SHELL_CUT_ENV=1); d_cut0=$(dflt KOSMOS_SHELL_CUT_ENV=0)
d_ci=$(dflt CI=true); d_ci1=$(dflt CI=1); d_ci0=$(dflt CI=false); d_ciyes=$(dflt CI=YES); d_ciF=$(dflt CI=FALSE)
d_cizero=$(dflt CI=0); d_ciempty=$(dflt CI=)
got="plain=$d_plain gha=$d_gha gha-false=$d_gha_no shard=$d_shard platform=$d_plat cutenv=$d_cut cutenv0=$d_cut0 ci=$d_ci ci1=$d_ci1 ci-false=$d_ci0 ci-YES=$d_ciyes ci-FALSE=$d_ciF ci-0=$d_cizero ci-empty=$d_ciempty"
if [ "$got" = "plain=4 gha=1 gha-false=4 shard=1 platform=1 cutenv=1 cutenv0=4 ci=1 ci1=1 ci-false=4 ci-YES=1 ci-FALSE=4 ci-0=4 ci-empty=4" ]; then
  pass "the unset default is 4 locally and 1 in CI (GITHUB_ACTIONS or CI), a CI shard or platform share, and the cut-env shape"
else
  bad "the unset default: $got"
fi

# 9) the default, end to end: the real run-tests.sh with a stub node first on PATH, which records each shell-shard.js
# call and runs nothing. Unset starts shards 1 to 4 of 4; GITHUB_ACTIONS=true runs shard 1 of 1; a value the caller
# set is kept. Like the refusal arms it runs under the 60 s group kill, and it skips the suite queue (the order of
# the stub's calls is not asserted, only the set).
mkdir -p "$T/stubnode"
cat > "$T/stubnode/node" <<STUBNODE
#!/bin/sh
printf '%s KSP=%s\n' "\$*" "\${KOSMOS_SHELL_PARALLEL-unset}" >> "$T/node-argv.log"
exit 0
STUBNODE
chmod +x "$T/stubnode/node"
rtd() {  # <env assignments...>: run-tests.sh's shell part with the stub node; sets RT_RC, RT_OUT and RT_SHARDS
  : > "$T/node-argv.log"
  RT_OUT=$(env -u GITHUB_ACTIONS -u CI -u KOSMOS_SHELL_SHARD -u KOSMOS_SHELL_PLATFORM -u KOSMOS_SHELL_CUT_ENV -u KOSMOS_SHELL_PARALLEL -u KOSMOS_TEST_PART -u KOSMOS_TEST_PART_LOCAL "$@" PATH="$T/stubnode:$PATH" KOSMOS_TEST_PART=shell KOSMOS_TEST_PART_LOCAL=1 KOSMOS_IGNORE_MACHINE_CLAIM=1 KOSMOS_TESTS_IGNORE_SUITE=1 KOSMOS_TESTS_IGNORE_HARNESS=1 perl -e "$GROUP60" /bin/bash "$HERE/run-tests.sh" 2>&1 < /dev/null); RT_RC=$?
  RT_SHARDS=$(grep -oE 'shell-shard\.js run [0-9]+ [0-9]+' "$T/node-argv.log" | sed 's/.*shell-shard\.js //' | sort | tr '\n' ';')
  RT_KSP=$(grep 'shell-shard\.js run' "$T/node-argv.log" | grep -oE 'KSP=[^ ]*' | sort -u | tr '\n' ' ')
}
# Accepted on purpose: these four nested runs start from the real tree, not a kt sandbox, so for the second or so each
# takes (node is a stub) another agent's suite count can see one more live suite and ask again 30 s later.
# Judged on the shard calls alone: the run's own exit status also carries the gates at the end of run-tests.sh (the
# browser-check trailer gates read this repo's branch diff), which are not what this arm tests. A run refused before
# the shell part starts no shard, so it still reds here. The status is printed on a red to show which it was.
rtd
d_run="$RT_SHARDS"; r_run=$RT_RC; k_run="$RT_KSP"
rtd GITHUB_ACTIONS=true
d_ci="$RT_SHARDS"; r_ci=$RT_RC
rtd KOSMOS_SHELL_PARALLEL=2
d_two="$RT_SHARDS"; r_two=$RT_RC
rtd KOSMOS_SHELL_PARALLEL=
d_empty="$RT_SHARDS"; r_empty=$RT_RC
if [ "$d_run" = "run 1 4;run 2 4;run 3 4;run 4 4;" ] && [ "$k_run" = "KSP=1 " ] && [ "$d_ci" = "run 1 1;" ] && [ "$d_two" = "run 1 2;run 2 2;" ] \
   && [ "$d_empty" = "run 1 1;" ]; then
  pass "run-tests.sh: unset starts 4 shards, GITHUB_ACTIONS=true runs 1 of 1, a set value is kept, and empty is 1"
else
  bad "run-tests.sh default end to end (shards saw [$k_run]; rc unset=$r_run ci=$r_ci two=$r_two empty=$r_empty): unset=[$d_run] ci=[$d_ci] two=[$d_two] empty=[$d_empty] out=$(printf '%s' "$RT_OUT" | tail -c 300)"
fi

# 10) a TRIPWIRE on release.sh, which a test cannot run as a cut: it says 1 for its gate runs, after its guard (so
# the guard still sees the caller's own value first).
# The export must be the first code after the guard's own fi, at the top level (not inside a later branch), and no
# code after it may unset, scrub or reassign the switch.
guard_at=$(grep -n 'A cut always tests the whole suite (#5934)' "$HERE/release.sh" | head -1 | cut -d: -f1)
export_at=$(grep -n -x 'export KOSMOS_SHELL_PARALLEL=1' "$HERE/release.sh" | head -1 | cut -d: -f1)
between=""; later=""
if [ -n "$guard_at" ] && [ -n "$export_at" ] && [ "$export_at" -gt "$guard_at" ]; then
  between=$(awk -v g="$guard_at" -v e="$export_at" 'NR > g && NR < e && !/^[[:space:]]*#/ && !/^[[:space:]]*$/' "$HERE/release.sh")
  later=$(awk -v e="$export_at" 'NR > e && !/^[[:space:]]*#/ && (/KOSMOS_SHELL_PARALLEL/ || /env -i/)' "$HERE/release.sh")
fi
if [ -n "$guard_at" ] && [ -n "$export_at" ] && [ "$export_at" -gt "$guard_at" ] && [ "$between" = "fi" ] && [ -z "$later" ]; then
  pass "release.sh: a cut sets KOSMOS_SHELL_PARALLEL=1 right after its guard's fi, and nothing later touches it"
else
  bad "release.sh: export at '${export_at:-none}', guard at '${guard_at:-none}', code between=[$between], later=[$(printf '%s' "$later" | head -2)]"
fi

if [ "$fails" -eq 0 ]; then echo "test-shell-parallel-7100: all arms passed"; exit 0; fi
echo "test-shell-parallel-7100: $fails failure(s)"; exit 1
