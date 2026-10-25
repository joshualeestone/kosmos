# #7100: run test:shell's shards at once on this computer, for tools/run-tests.sh's KOSMOS_SHELL_PARALLEL.
#
# Each shard runs under this perl supervisor, which leads the shard's process group and forks the shard's command
# beneath it. Its first argument is the runner's pid, read by the shell before the fork, so a runner that dies before
# perl starts is still seen as gone. It exits with the command's status. A TERM or INT sent to it is passed on to the
# whole group; so is a TERM of its own when its parent is no longer the runner, even after a KILL that ran no trap.
# Once it has passed a signal on, it waits until its group holds nothing but itself, or 2 s, and then KILLs the
# group, itself included, so a process that ignored the TERM does not outlive its shard.
_KOSMOS_SHARD_SUPERVISOR='use POSIX (); use Time::HiRes ();
setpgrp(0, 0);
my $runner = shift @ARGV;
my ($passed, $status) = (0, undef);
my $pass = sub { my $sig = shift; $SIG{$sig} = "IGNORE"; $passed ||= Time::HiRes::time(); kill $sig, -$$ };
my ($was_term, $was_int) = ($SIG{TERM} // "DEFAULT", $SIG{INT} // "DEFAULT");
$SIG{TERM} = $pass; $SIG{INT} = $pass;
my $kid = fork;
die "fork: $!" unless defined $kid;
if (!$kid) { $SIG{TERM} = $was_term; $SIG{INT} = $was_int; exec @ARGV or die "exec: $!" }
# Every other member of the group. A process named ps is skipped: the listing below is one, and it joins the group.
my $others = sub {
  my $n = 0;
  for (`ps -axo pid=,pgid=,comm=`) { my ($p, $g, $c) = split " ", $_, 3; $n++ if $g == $$ && $p != $$ && $c !~ /^ps\b/ }
  $n;
};
while (1) {
  if (!defined $status && waitpid($kid, POSIX::WNOHANG()) == $kid) { $status = ($? & 127) ? 128 + ($? & 127) : $? >> 8 }
  exit $status if defined $status && (!$passed || !$others->());
  if (getppid() != $runner && !$passed) {
    print STDERR "run-tests: this shell shard'"'"'s runner is gone; stopping the shard (#7100)\n";
    $pass->("TERM");
  }
  kill "KILL", -$$ if $passed && Time::HiRes::time() - $passed >= 2;
  Time::HiRes::sleep(0.2);
}'
#
# kosmos_shell_parallel <n> <log dir> <command...>
#   Starts <command...> <i> <n> for i = 1..n, all at once, each with its own log <log dir>/shard-<i>.log and each in
#   a process group of its own, led by its supervisor (above). The shards are waited on in shard order (bash 3.2
#   has no wait -n), and a line says each one's status when it is waited on, with the time it was seen to have
#   ended (a shard that ended before a lower-numbered one is reported late). When all have ended it prints the
#   logs in shard order, then one line naming the time taken and which shards were red. Returns 0 when every
#   shard returned 0, else the status of the lowest-numbered red shard.
#   KOSMOS_SHELL_PARALLEL_PIDS holds the shards still running and KOSMOS_SHELL_PARALLEL_DONE the ones waited on; each
#   pid is also the id of its shard's process group. kosmos_shell_parallel_stop, for the caller's EXIT trap, uses both.
#
# A shard is the command tools/shell-shard.js runs as `run <i> <n>`: the list it takes is fixed by a hash of each
# command, so the union of the shards is the whole list (tools.shell-shard-4317.test.js). The command is exec'd, so it
# must be a program, not a shell function.
kosmos_shell_parallel() {
  local n="$1" dir="$2"; shift 2
  local i p q r rc=0 red="" t0 left me
  # This shell's own pid, right in a subshell too ($$ is not, and bash 3.2 has no BASHPID): the exec makes sh a
  # direct child of this shell, so its parent pid is this shell's.
  me=$(exec sh -c 'echo $PPID')
  KOSMOS_SHELL_PARALLEL_PIDS=""; KOSMOS_SHELL_PARALLEL_DONE=""; KOSMOS_SHELL_PARALLEL_DIR="$dir"
  t0=$(date +%s)
  i=1
  while [ "$i" -le "$n" ]; do
    # The supervisor keeps this pid and leads a group of its own, which the shard's command and its children join.
    perl -e "$_KOSMOS_SHARD_SUPERVISOR" "$me" "$@" "$i" "$n" > "$dir/shard-$i.log" 2>&1 &
    KOSMOS_SHELL_PARALLEL_PIDS="$KOSMOS_SHELL_PARALLEL_PIDS $!"
    i=$((i + 1))
  done
  local all="$KOSMOS_SHELL_PARALLEL_PIDS"
  # Nothing else prints until shard 1 has been waited on; each shard's own log has a line per command meanwhile.
  echo "run-tests: test:shell runs as $n shards at once; each one's progress is in $dir/shard-<i>.log (#7100)"
  i=1
  for p in $all; do
    wait "$p"; r=$?
    left=""
    for q in $KOSMOS_SHELL_PARALLEL_PIDS; do [ "$q" = "$p" ] || left="$left $q"; done
    KOSMOS_SHELL_PARALLEL_PIDS="$left"; KOSMOS_SHELL_PARALLEL_DONE="$KOSMOS_SHELL_PARALLEL_DONE $p"
    echo "run-tests: shell shard $i of $n: status $r, seen ended at $(( $(date +%s) - t0 )) s (#7100)"
    if [ "$r" -ne 0 ]; then
      [ "$rc" -ne 0 ] || rc=$r
      red="$red $i"
    fi
    i=$((i + 1))
  done
  KOSMOS_SHELL_PARALLEL_PIDS=""; KOSMOS_SHELL_PARALLEL_DONE=""; KOSMOS_SHELL_PARALLEL_DIR=""
  i=1
  while [ "$i" -le "$n" ]; do cat "$dir/shard-$i.log"; i=$((i + 1)); done
  if [ -n "$red" ]; then
    echo "run-tests: test:shell ran as $n shards at once in $(( $(date +%s) - t0 )) s; red: shard$red (#7100)"
  else
    echo "run-tests: test:shell ran as $n shards at once in $(( $(date +%s) - t0 )) s; all green (#7100)"
  fi
  return "$rc"
}

# kosmos_shell_parallel_stop, for an EXIT trap: TERM the process group of every shard still running, and of every
# shard already waited on whose group still has members (something its tests left running). The second list is
# signalled only when a kill -0 on the group finds a process in it. That cannot tell the shard's own group from a
# new one that took the id after the shard's group emptied and the pid was reused; that takes the group to empty and
# the pid space to wrap within one run, and such a stranger would get a TERM. A shard not yet waited on is signalled
# while this shell is its parent, or, once it has ended unwaited, while its group still has a member. Then wait up
# to about 2 s for the groups to be gone, KILL what is left, and print the end of each shard's log to stderr (the
# caller removes the logs next). A process that left its shard's group (setsid) is not reached.
kosmos_shell_parallel_stop() {
  local p k live targets="" f
  # A shard not yet waited on may still have ended: bash reaps a child as it exits, so its pid can be free. It is
  # signalled only while this shell is its parent, which a process that took the pid since cannot be.
  # A shard that ended unwaited fails that check (its pid has no process), yet its group can still hold something it
  # started; that group is signalled when kill -0 finds a process in it, as for a waited-on shard below.
  for p in ${KOSMOS_SHELL_PARALLEL_PIDS:-}; do
    if [ "$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')" = "$$" ]; then targets="$targets $p"
    elif ! kill -0 "$p" 2>/dev/null && kill -0 -- "-$p" 2>/dev/null; then targets="$targets $p"
    fi
  done
  for p in ${KOSMOS_SHELL_PARALLEL_DONE:-}; do kill -0 -- "-$p" 2>/dev/null && targets="$targets $p"; done
  for p in $targets; do kill -TERM -- "-$p" 2>/dev/null; done
  k=0
  while [ "$k" -lt 20 ]; do
    live=0
    for p in $targets; do kill -0 -- "-$p" 2>/dev/null && live=1; done
    [ "$live" = 0 ] && break
    sleep 0.1; k=$((k + 1))
  done
  # What ignored the TERM or was slow to go gets a KILL, so nothing of a shard outlives the trap's next steps.
  for p in $targets; do kill -0 -- "-$p" 2>/dev/null && kill -KILL -- "-$p" 2>/dev/null; done
  # The shard logs are removed with their folder after this; their ends say where each shard was stopped.
  if [ -n "${KOSMOS_SHELL_PARALLEL_DIR:-}" ] && [ -d "$KOSMOS_SHELL_PARALLEL_DIR" ]; then
    for f in "$KOSMOS_SHELL_PARALLEL_DIR"/shard-*.log; do
      [ -f "$f" ] || continue
      echo "run-tests: interrupted; the last lines of $(basename "$f") (#7100):" >&2
      tail -n 15 "$f" >&2
    done
  fi
  KOSMOS_SHELL_PARALLEL_PIDS=""; KOSMOS_SHELL_PARALLEL_DONE=""; KOSMOS_SHELL_PARALLEL_DIR=""
  return 0
}

# kosmos_shell_parallel_default
#   Prints the number of shards an unset KOSMOS_SHELL_PARALLEL means: 4 on a plain local run, and 1 (the
#   one-at-a-time run) in CI (GITHUB_ACTIONS=true, or CI set to anything but false or 0, in any case), in a CI
#   shard or platform share (KOSMOS_SHELL_SHARD, KOSMOS_SHELL_PLATFORM) and in the cut-env shape
#   (KOSMOS_SHELL_CUT_ENV=1). Four was measured on 2026-10-25: 603 s on Agent1s and 682 and 669 s on Mortals,
#   against 2,285 s and 2,209 to 2,594 s one at a time, 290 of 290 green every time (#7100). A release cut sets 1
#   itself (tools/release.sh).
kosmos_shell_parallel_default() {
  local ci
  ci="$(printf '%s' "${CI:-}" | tr '[:upper:]' '[:lower:]')"
  case "$ci" in ''|false|0) ci="" ;; esac
  if [ "${GITHUB_ACTIONS:-}" = true ] || [ -n "$ci" ] \
     || [ -n "${KOSMOS_SHELL_SHARD:-}" ] || [ -n "${KOSMOS_SHELL_PLATFORM:-}" ] \
     || [ "${KOSMOS_SHELL_CUT_ENV:-0}" = 1 ]; then
    echo 1
  else
    echo 4
  fi
}
