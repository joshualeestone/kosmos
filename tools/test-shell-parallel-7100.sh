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
if [ "$rc" = 0 ] && [ "$(printf '%s\n' "$out" | sed -n 1,3p)" = "$want" ] && printf '%s\n' "$out" | tail -n 1 | grep -q 'ran as 3 shards at once in [0-9]* s; all green' && [ -z "$KOSMOS_SHELL_PARALLEL_PIDS" ]; then
  pass "three green shards: status 0, logs in shard order (shard 1 finished last), all green, no pids left"
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

# 5) run-tests.sh refuses a value it cannot run, before running anything: exit 2 and a line naming the variable.
# A perl alarm bounds each arm, so a refusal that failed would cost a red here, never a suite run.
rt() {  # <env assignments...>: run tools/run-tests.sh with them; sets RT_RC and RT_OUT
  RT_OUT=$(env "$@" KOSMOS_TEST_PART=shell KOSMOS_TEST_PART_LOCAL=1 perl -e 'alarm 60; exec @ARGV or die' /bin/bash "$HERE/run-tests.sh" 2>&1 < /dev/null); RT_RC=$?
}
for v in 9 0 abc 1x; do
  rt KOSMOS_SHELL_PARALLEL="$v"
  if [ "$RT_RC" = 2 ] && printf '%s' "$RT_OUT" | grep -q "KOSMOS_SHELL_PARALLEL must be a whole number from 1 to 8 (got '$v')"; then
    pass "run-tests refuses KOSMOS_SHELL_PARALLEL=$v (exit 2)"
  else
    bad "run-tests KOSMOS_SHELL_PARALLEL=$v: rc=$RT_RC(2) out=$(printf '%s' "$RT_OUT" | head -c 300)"
  fi
done
rt KOSMOS_SHELL_PARALLEL=2 KOSMOS_SHELL_SHARD=1/2
if [ "$RT_RC" = 2 ] && printf '%s' "$RT_OUT" | grep -q "KOSMOS_SHELL_PARALLEL and KOSMOS_SHELL_SHARD do not combine"; then
  pass "run-tests refuses KOSMOS_SHELL_PARALLEL with KOSMOS_SHELL_SHARD (exit 2)"
else
  bad "run-tests parallel+shard: rc=$RT_RC(2) out=$(printf '%s' "$RT_OUT" | head -c 300)"
fi

if [ "$fails" -eq 0 ]; then echo "test-shell-parallel-7100: all arms passed"; exit 0; fi
echo "test-shell-parallel-7100: $fails failure(s)"; exit 1
