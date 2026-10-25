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
sleep 300 & echo "$!" > "$STUB_KIDS/kid-$1"
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
STUB_KIDS="$T/kids" /bin/bash "$T/runner.sh" "$HERE/lib/shell-parallel.sh" "$T/l4b" "$T/stubkid.sh" &
sub=$!
k=0; while [ "$(ls "$T/kids" | grep -c '^kid-')" -lt 2 ] && [ "$k" -lt 300 ]; do sleep 0.1; k=$((k + 1)); done
kill -TERM "$sub" 2>/dev/null; wait "$sub" 2>/dev/null
alive=0; for f in "$T/kids"/kid-*; do kp=$(cat "$f"); k=0; while kill -0 "$kp" 2>/dev/null && [ "$k" -lt 50 ]; do sleep 0.1; k=$((k + 1)); done; kill -0 "$kp" 2>/dev/null && { alive=$((alive + 1)); kill "$kp" 2>/dev/null; }; done
if [ "$(ls "$T/kids" | grep -c '^kid-')" = 2 ] && [ "$alive" = 0 ]; then pass "a TERM stops both shards' running tests (no orphan outlives the run)"
else bad "interruption: kids recorded $(ls "$T/kids" | grep -c '^kid-')(2), still alive after the stop: $alive(0)"; fi

# 4c) a shard already waited on can leave something running in its group (a backgrounded server, a sleep). The stop
# reaches it too: shard 1 leaves a sleep and ends at once, shard 2 is still running when the TERM comes.
cat > "$T/stubleft.sh" <<'STUBLEFT'
#!/bin/bash
sleep 300 & echo "$!" > "$STUB_KIDS/kid-$1"
[ "$1" = 1 ] && exit 0
wait
STUBLEFT
chmod +x "$T/stubleft.sh"
mkdir -p "$T/l4c" "$T/kids4c"
STUB_KIDS="$T/kids4c" /bin/bash "$T/runner.sh" "$HERE/lib/shell-parallel.sh" "$T/l4c" "$T/stubleft.sh" &
sub=$!
k=0; while [ "$(ls "$T/kids4c" | grep -c '^kid-')" -lt 2 ] && [ "$k" -lt 300 ]; do sleep 0.1; k=$((k + 1)); done
# Until shard 1 has been waited on (its status line), so the stop meets it in the waited-on list.
k=0; while ! grep -q 'shell shard 1 of 2: status' "$T/l4c.out" 2>/dev/null && [ "$k" -lt 300 ]; do sleep 0.1; k=$((k + 1)); done
kill -TERM "$sub" 2>/dev/null; wait "$sub" 2>/dev/null
alive=0; for f in "$T/kids4c"/kid-*; do kp=$(cat "$f"); k=0; while kill -0 "$kp" 2>/dev/null && [ "$k" -lt 50 ]; do sleep 0.1; k=$((k + 1)); done; kill -0 "$kp" 2>/dev/null && { alive=$((alive + 1)); kill "$kp" 2>/dev/null; }; done
if [ "$(ls "$T/kids4c" | grep -c '^kid-')" = 2 ] && [ "$alive" = 0 ]; then pass "a TERM also stops what a finished shard left running in its group"
else bad "finished shard's leftover: kids recorded $(ls "$T/kids4c" | grep -c '^kid-')(2), still alive after the stop: $alive(0)"; fi

# 5) run-tests.sh refuses a value it cannot run, before running anything: exit 2 and a line naming the variable.
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

# 7) the switch is this run's alone (a TRIPWIRE on the source): once validated it is unset, so the tests the run
# starts, some of which start run-tests.sh with a scrubbed environment that predates the switch, never inherit it.
# The boundary is the unset line itself, found by its number; comments, indented or not, do not count as reads.
unset_at=$(grep -n -x '_RT_SHELL_PARALLEL="\$KOSMOS_SHELL_PARALLEL"; unset KOSMOS_SHELL_PARALLEL' "$HERE/run-tests.sh" | cut -d: -f1)
later=""
[ -n "$unset_at" ] && later=$(grep -n 'KOSMOS_SHELL_PARALLEL' "$HERE/run-tests.sh" | grep -v '^[0-9]*:[[:space:]]*#' | awk -F: -v u="$unset_at" '$1 > u')
if [ -n "$unset_at" ] && [ -z "$later" ]; then
  pass "run-tests.sh: the switch is kept privately and unset, and nothing after its validation reads it"
else
  bad "run-tests.sh: KOSMOS_SHELL_PARALLEL unset at line '${unset_at:-none}', read after it: $(printf '%s' "$later" | head -3)"
fi

if [ "$fails" -eq 0 ]; then echo "test-shell-parallel-7100: all arms passed"; exit 0; fi
echo "test-shell-parallel-7100: $fails failure(s)"; exit 1
