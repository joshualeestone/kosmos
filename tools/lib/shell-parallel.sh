# #7100: run test:shell's shards at once on this computer, for tools/run-tests.sh's KOSMOS_SHELL_PARALLEL.
#
# kosmos_shell_parallel <n> <log dir> <command...>
#   Starts <command...> <i> <n> for i = 1..n, all at once, each with its own log <log dir>/shard-<i>.log. When all
#   have ended it prints the logs in shard order, then one line naming the time taken and which shards were red.
#   Returns 0 when every shard returned 0, else the first red shard's status. While the shards run, their pids are in
#   KOSMOS_SHELL_PARALLEL_PIDS (space separated) so the caller's EXIT trap can stop them; it is empty again at return.
#
# A shard is the command tools/shell-shard.js runs as `run <i> <n>`: the list it takes is fixed by a hash of each
# command, so the union of the shards is the whole list (tools.shell-shard-4317.test.js).
kosmos_shell_parallel() {
  local n="$1" dir="$2"; shift 2
  local i p r rc=0 red="" t0
  KOSMOS_SHELL_PARALLEL_PIDS=""
  t0=$(date +%s)
  i=1
  while [ "$i" -le "$n" ]; do
    "$@" "$i" "$n" > "$dir/shard-$i.log" 2>&1 &
    KOSMOS_SHELL_PARALLEL_PIDS="$KOSMOS_SHELL_PARALLEL_PIDS $!"
    i=$((i + 1))
  done
  i=1
  for p in $KOSMOS_SHELL_PARALLEL_PIDS; do
    wait "$p"; r=$?
    if [ "$r" -ne 0 ]; then
      [ "$rc" -ne 0 ] || rc=$r
      red="$red $i"
    fi
    i=$((i + 1))
  done
  KOSMOS_SHELL_PARALLEL_PIDS=""
  i=1
  while [ "$i" -le "$n" ]; do cat "$dir/shard-$i.log"; i=$((i + 1)); done
  if [ -n "$red" ]; then
    echo "run-tests: test:shell ran as $n shards at once in $(( $(date +%s) - t0 )) s; red: shard$red (#7100)"
  else
    echo "run-tests: test:shell ran as $n shards at once in $(( $(date +%s) - t0 )) s; all green (#7100)"
  fi
  return "$rc"
}
