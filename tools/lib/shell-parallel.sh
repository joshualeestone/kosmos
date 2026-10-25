# #7100: run test:shell's shards at once on this computer, for tools/run-tests.sh's KOSMOS_SHELL_PARALLEL.
#
# kosmos_shell_parallel <n> <log dir> <command...>
#   Starts <command...> <i> <n> for i = 1..n, all at once, each with its own log <log dir>/shard-<i>.log and each the
#   leader of its own process group. Says so as each shard ends; when all have ended it prints the logs in shard order,
#   then one line naming the time taken and which shards were red. Returns 0 when every shard returned 0, else the
#   first red shard's status.
#   KOSMOS_SHELL_PARALLEL_PIDS holds the pids of the shards still running (space separated): each is the id of its
#   shard's process group, so the caller's EXIT trap can stop a whole shard, the test it is running included, with
#   kosmos_shell_parallel_stop. A shard leaves the list as soon as it has been waited on, so the trap never signals a
#   pid that an unrelated process may have taken since.
#
# A shard is the command tools/shell-shard.js runs as `run <i> <n>`: the list it takes is fixed by a hash of each
# command, so the union of the shards is the whole list (tools.shell-shard-4317.test.js).
kosmos_shell_parallel() {
  local n="$1" dir="$2"; shift 2
  local i p r rc=0 red="" t0 left
  KOSMOS_SHELL_PARALLEL_PIDS=""
  t0=$(date +%s)
  i=1
  while [ "$i" -le "$n" ]; do
    # setpgrp then exec: the shard keeps this pid and leads a group of its own, which its children join.
    perl -e 'setpgrp(0, 0); exec @ARGV or die "exec: $!"' "$@" "$i" "$n" > "$dir/shard-$i.log" 2>&1 &
    KOSMOS_SHELL_PARALLEL_PIDS="$KOSMOS_SHELL_PARALLEL_PIDS $!"
    i=$((i + 1))
  done
  local all="$KOSMOS_SHELL_PARALLEL_PIDS"
  i=1
  for p in $all; do
    wait "$p"; r=$?
    left=""
    for q in $KOSMOS_SHELL_PARALLEL_PIDS; do [ "$q" = "$p" ] || left="$left $q"; done
    KOSMOS_SHELL_PARALLEL_PIDS="$left"
    echo "run-tests: shell shard $i of $n ended (status $r) after $(( $(date +%s) - t0 )) s (#7100)"
    if [ "$r" -ne 0 ]; then
      [ "$rc" -ne 0 ] || rc=$r
      red="$red $i"
    fi
    i=$((i + 1))
  done
  i=1
  while [ "$i" -le "$n" ]; do cat "$dir/shard-$i.log"; i=$((i + 1)); done
  if [ -n "$red" ]; then
    echo "run-tests: test:shell ran as $n shards at once in $(( $(date +%s) - t0 )) s; red: shard$red (#7100)"
  else
    echo "run-tests: test:shell ran as $n shards at once in $(( $(date +%s) - t0 )) s; all green (#7100)"
  fi
  return "$rc"
}

# kosmos_shell_parallel_stop: TERM every shard still running, each as its whole process group. For an EXIT trap.
kosmos_shell_parallel_stop() {
  local p
  for p in ${KOSMOS_SHELL_PARALLEL_PIDS:-}; do kill -TERM -- "-$p" 2>/dev/null; done
  KOSMOS_SHELL_PARALLEL_PIDS=""
  return 0
}
