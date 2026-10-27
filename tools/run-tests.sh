#!/usr/bin/env bash
# `yarn test`, with the machine named beside a red (#708).
#
# Three false reds on 2026-08-24 were caused by what this Mac was doing, not
# by the change under test: fixed ports colliding across gate runs (#633), a
# stalled spawn crossing a 5-second look timeout (#704), and a full suite
# going 8 red beside two live boards and a gate run (Angel). Every one was
# green alone. The standard answer to an unexplained red is to re-run it,
# which trains everyone to read reds as noise, and a gate people re-run
# rather than read has stopped being a gate.
#
# So this records what the machine was doing when the run STARTED, runs the
# suite unchanged, and only if the suite is red prints that record beside the
# failures: "this run shared the machine with a live board on :16180 from
# <cwd> (pid), N other gate runs, load L". The person then knows whether to
# rerun alone or read the red. Green runs print nothing extra (#6668: except two file-watchdog lines on stderr: "node
# --test not found yet", which prints on a green run whenever node takes 5 s or more to start, at any limit, and
# "could not make the file watchdog's flag file", when its flag file cannot be made).
#
# The suite itself is isolated by construction (every booted server takes
# port 0, every store-using test sandboxes before requiring, every shell test
# stubs launchctl), so this names contention; it does not paper over a test
# that reaches shared state. Such a test is a bug, and its red still shows.
set -uo pipefail
REPO="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"   # CDPATH= : #4929 review 16, an exported CDPATH bends a relative cd
cd "$REPO"

# #4317: CI runs the two halves as separate parallel jobs. KOSMOS_TEST_PART picks one:
#   all   (the default, and what `yarn test` runs): the node suite, then test:shell, as before;
#   node  the node suite only;
#   shell test:shell only, or with KOSMOS_SHELL_SHARD=i/n just shard i of n (tools/shell-shard.js), and with
#         KOSMOS_SHELL_PLATFORM=linux|mac as well (only with a shard, #6791) just that platform's share of it.
#         KOSMOS_SHELL_PARALLEL=n (#7100, 1 to 8) runs all of test:shell as n shards at once on this computer;
#         unset is 4 locally and 1 in CI, a CI shard or platform share, or the cut-env shape
#         (kosmos_shell_parallel_default); set but empty is 1, and a release cut sets 1
#         (it has no effect on the node part or --only, which run no shell part, though a bad value still refuses).
# Every part keeps every guard below (coverage, launchd, temp root, leaks, the browser-check gates). --only (#4929,
# below) keeps the temp root, the --require guards and the leak guards, and skips the queue wait, the coverage count,
# the shell part and the browser-check gates.
# A value it does not know refuses HERE, first, before the machine claim, the temp root or any test,
# rather than running a subset silently. tools.shell-shard-4317.test.js runs each refusal.
KOSMOS_TEST_PART="${KOSMOS_TEST_PART:-all}"
case "$KOSMOS_TEST_PART" in
  all|node|shell) ;;
  *) echo "run-tests: KOSMOS_TEST_PART must be all, node or shell (got '$KOSMOS_TEST_PART')" >&2; exit 2 ;;
esac
# A part other than all runs only some of the suite, so it is honoured only where it is meant: in
# CI (GITHUB_ACTIONS=true), or locally with KOSMOS_TEST_PART_LOCAL=1 said on purpose. A value merely
# inherited from a shell would otherwise narrow a release cut's or a validation's `yarn test` to a
# part and let it pass. And a part always says so, on stderr, so a log shows what ran.
if [ "$KOSMOS_TEST_PART" != all ]; then
  if [ "${GITHUB_ACTIONS:-}" != true ] && [ "${KOSMOS_TEST_PART_LOCAL:-}" != 1 ]; then
    echo "run-tests: KOSMOS_TEST_PART=$KOSMOS_TEST_PART runs only part of the suite; outside CI, set KOSMOS_TEST_PART_LOCAL=1 to mean it (unset KOSMOS_TEST_PART for the whole suite)" >&2
    exit 2
  fi
  echo "run-tests: running ONLY the $KOSMOS_TEST_PART part of the suite${KOSMOS_SHELL_SHARD:+ (shard $KOSMOS_SHELL_SHARD)} (#4317); the other part runs in its own job" >&2
fi
# #4929: `tools/run-tests.sh --only <file>...` runs the named test files with everything below that a test needs (the
# dead-port URLs, the fake gh and vercel, the unsets, the per-run temp root, the --require guards, the leak guards),
# and without what belongs to the whole suite: the queue WAIT (a light queue turn already holds its place; the release
# claim and install-harness refusals are still asked, once), the coverage count, the shell part and the branch's
# browser-check gates. A bare `node --test <file>` skips all of it. Other suites' "is a suite live" checks still see
# a --only run as one (it is run-tests.sh), so they wait for it or refuse: the safe direction. A --only run itself
# does NOT wait for or refuse a live suite (no queue wait, above): it is meant for inside a light queue turn. So a
# --only run outside one can overlap a suite or a live board, and its #3011 LaunchAgents guard can then red on THEIR
# plist; that red names the cause. The trade-off is taken for not waiting.
KOSMOS_ONLY=0
KOSMOS_ONLY_FILES=()
# --only counts only as the FIRST argument. Anywhere else it would reach node --test beside every suite file, so the
# whole suite would run; it refuses instead.
# The --only=<file> spelling is refused too, wherever it is: it is not a leading --only, so it would take the
# full-suite path, where the suite's files come first and node ignores the extra argument: the whole suite would run
# (after a heavy queue turn), not the file. This block scans every argument on purpose, full-suite runs included.
for _only_f in "$@"; do
  case "$_only_f" in --only=*) echo "run-tests: --only takes its files as separate arguments (tools/run-tests.sh --only <file>...), not --only=<file>" >&2; exit 2 ;; esac
done
if [ "${1:-}" != --only ]; then
  for _only_f in "$@"; do
    if [ "$_only_f" = --only ]; then
      echo "run-tests: --only must come first (tools/run-tests.sh --only <file>...); refusing rather than running the whole suite" >&2
      exit 2
    fi
  done
fi
if [ "${1:-}" = --only ]; then
  shift
  if [ "$KOSMOS_TEST_PART" != all ] || [ -n "${KOSMOS_SHELL_SHARD:-}" ]; then
    echo "run-tests: --only runs named files; it does not take KOSMOS_TEST_PART or KOSMOS_SHELL_SHARD (got part '$KOSMOS_TEST_PART'${KOSMOS_SHELL_SHARD:+, shard '$KOSMOS_SHELL_SHARD'})" >&2
    exit 2
  fi
  if [ "$#" -eq 0 ]; then
    echo "run-tests: --only needs one or more test files, e.g. tools/run-tests.sh --only engine/tasks.test.js" >&2
    exit 2
  fi
  _only_rel=0
  _only_repo="$(CDPATH= cd "$REPO" && pwd -P)"   # the repo's physical path, the same spelling as each file's below
  for _only_f in "$@"; do
    case "$_only_f" in /*) ;; *) _only_rel=1 ;; esac
    case "$_only_f" in
      -*) echo "run-tests: --only takes test files, not node --test options (got '$_only_f')" >&2; exit 2 ;;
      *.test.js) ;;
      *) echo "run-tests: --only takes *.test.js files (got '$_only_f')" >&2; exit 2 ;;
    esac
    if [ ! -f "$_only_f" ]; then
      case "$_only_f" in /*) echo "run-tests: no test file '$_only_f'" >&2 ;; *) echo "run-tests: no test file '$_only_f' (a relative path is read from the repo root)" >&2 ;; esac
      exit 2
    fi
    # One spelling per file (a.test.js, ./a.test.js, p/../a.test.js, a symlinked folder, its absolute path): the
    # folder's physical path plus the name.
    # CDPATH= : an exported CDPATH would send a relative cd into ANOTHER tree and print its path into the result.
    _only_f="$(CDPATH= cd -P -- "$(dirname "$_only_f")" && pwd -P)/$(basename "$_only_f")"   # -P: through a symlink then .., the same file -f found
    # node --test reads each name as a glob: a path with [ * ? { ( ! or \ in it can match nothing (red, "Could not
    # find") or, with an extglob such as @(x), run zero tests and exit 0 (green, measured). So it is refused. A file
    # inside this repo goes to node by its repo-relative name (node runs from the repo root), so only that part is
    # checked: a checkout folder such as "kosmos (copy)" does not refuse every file.
    case "$_only_f" in "$_only_repo"/*) _only_f="${_only_f#"$_only_repo"/}" ;; esac
    case "$_only_f" in *'['*|*'*'*|*'?'*|*'{'*|*'('*|*'!'*|*'\'*) echo "run-tests: --only cannot take '$_only_f': node --test reads [ * ? { ( ! \\ as a pattern, so it could run nothing" >&2; exit 2 ;; esac
    # A repo file named -x.test.js: node --test starts each file as a child by the name it was given, and a relative
    # "-x.test.js" (even spelled ./-x.test.js) reaches that child as an option. Its absolute path cannot (measured).
    case "$_only_f" in -*) _only_f="$_only_repo/$_only_f" ;; esac
    _only_dup=0
    for _only_g in ${KOSMOS_ONLY_FILES[@]+"${KOSMOS_ONLY_FILES[@]}"}; do [ "$_only_g" = "$_only_f" ] && _only_dup=1; done
    [ "$_only_dup" = 1 ] || KOSMOS_ONLY_FILES+=("$_only_f")   # a file named twice runs once
  done
  set --
  KOSMOS_ONLY=1
  echo "run-tests: --only: ${#KOSMOS_ONLY_FILES[@]} named file(s), not the whole suite (#4929)" >&2
  # Relative names are read from THIS runner's repo root, not the caller's folder: print what will run, and say so
  # when the caller is elsewhere (another worktree's runner would otherwise test its own copy of the file, green).
  # OLDPWD is the caller's folder: the `cd "$REPO"` at the top is the only cd before here.
  for _only_f in "${KOSMOS_ONLY_FILES[@]}"; do case "$_only_f" in /*) echo "run-tests: --only:   $_only_f" >&2 ;; *) echo "run-tests: --only:   $_only_repo/$_only_f" >&2 ;; esac; done
  # Physical paths both sides: a caller in this tree through a symlinked spelling is not told otherwise.
  if [ "$_only_rel" = 1 ] && [ -n "${OLDPWD:-}" ] && [ "$(CDPATH= cd "$OLDPWD" 2>/dev/null && pwd -P)" != "$_only_repo" ]; then
    echo "run-tests: --only: note: relative names are read from this runner's tree ($REPO), not from your folder ($OLDPWD)" >&2
  fi
fi
# Extra arguments go to node --test, so a shell-only run has nowhere to put them: refuse them.
if [ "$KOSMOS_TEST_PART" = shell ] && [ "$#" -gt 0 ]; then
  echo "run-tests: KOSMOS_TEST_PART=shell runs no node tests, so it takes no node --test arguments (got: $*)" >&2
  exit 2
fi
# A shard is only ever part of a shell-only run, and only in the form i/n. Anything else refuses:
# a stray value would otherwise turn `yarn test` into the node suite plus one shard, green.
if [ -n "${KOSMOS_SHELL_SHARD:-}" ]; then
  if [ "$KOSMOS_TEST_PART" != shell ] || ! printf '%s' "$KOSMOS_SHELL_SHARD" | grep -Eq '^[0-9]+/[0-9]+$'; then
    echo "run-tests: KOSMOS_SHELL_SHARD must be i/n and only with KOSMOS_TEST_PART=shell (got part '$KOSMOS_TEST_PART', shard '$KOSMOS_SHELL_SHARD')" >&2
    exit 2
  fi
fi
# #7100: KOSMOS_SHELL_PARALLEL=<n> runs test:shell as n shards at once on this computer (1 to 8; 1 is shard 1 of 1,
# the one-at-a-time run). Not with KOSMOS_SHELL_SHARD (that runs one shard; CI runs the others). Unset is
# kosmos_shell_parallel_default: 4 on a plain local run, 1 in CI, a CI shard or platform share, or the cut-env
# shape. Set but empty is 1, as it was before the default existed.
. "$REPO/tools/lib/shell-parallel.sh" || { echo "run-tests: tools/lib/shell-parallel.sh is missing" >&2; exit 1; }
if [ -z "${KOSMOS_SHELL_PARALLEL+x}" ]; then KOSMOS_SHELL_PARALLEL="$(kosmos_shell_parallel_default)"
elif [ -z "$KOSMOS_SHELL_PARALLEL" ]; then KOSMOS_SHELL_PARALLEL=1
fi
case "$KOSMOS_SHELL_PARALLEL" in
  1) ;;
  [2-8]) if [ -n "${KOSMOS_SHELL_SHARD:-}" ]; then
           echo "run-tests: KOSMOS_SHELL_PARALLEL and KOSMOS_SHELL_SHARD do not combine (got parallel '$KOSMOS_SHELL_PARALLEL', shard '$KOSMOS_SHELL_SHARD')" >&2
           exit 2
         fi
         # The cut's shape is one stand-in cut for one shell part, and its wrapper is a shell function that a shard
         # (started through exec) cannot run.
         if [ "${KOSMOS_SHELL_CUT_ENV:-0}" = 1 ]; then
           echo "run-tests: KOSMOS_SHELL_PARALLEL and KOSMOS_SHELL_CUT_ENV=1 do not combine (got parallel '$KOSMOS_SHELL_PARALLEL')" >&2
           exit 2
         fi ;;
  *) echo "run-tests: KOSMOS_SHELL_PARALLEL must be a whole number from 1 to 8 (got '$KOSMOS_SHELL_PARALLEL')" >&2
     exit 2 ;;
esac
# The value is this run's alone: kept privately, and everything this run starts gets 1, so a test that starts
# run-tests.sh itself runs its shell part one at a time rather than 4 shards inside a shard. A test that scrubs the
# environment (env -i, or dropping KOSMOS_ variables) gets the unset default instead, as any run with no value does.
_RT_SHELL_PARALLEL="$KOSMOS_SHELL_PARALLEL"; export KOSMOS_SHELL_PARALLEL=1
# #7247: on a Windows computer (Git Bash, MSYS, Cygwin), every node this run starts loads tools/no-schtasks-preload.cjs
# unless CI is set or KOSMOS_TESTS_REAL_SCHTASKS=1, so the suite cannot reach the computer's real Task Scheduler,
# where one test that reaches it could end the board's own task. The rule and the NODE_OPTIONS it builds are
# tools/windows-tests.js's own (childEnv, schedulerLine), read here rather than written twice. cygpath gives node a
# path it can read; without it the guard cannot be set up, and the run stops rather than reach the real scheduler.
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*)
    _RT_WIN=1   # #7257: read below by the suite and harness checks and by the node --test line
    if ! _rt_wt="$(cygpath -m "$REPO/tools/windows-tests.js" 2>/dev/null)" || [ -z "$_rt_wt" ]; then
      case "${CI:-}" in ""|false|FALSE|False|0) _rt_ci="" ;; *) _rt_ci=1 ;; esac   # as windows-tests.js onCi reads it
      if [ "${KOSMOS_TESTS_REAL_SCHTASKS:-}" != 1 ] && [ -z "$_rt_ci" ]; then
        echo "run-tests: cygpath is missing, so the #7247 schtasks guard cannot be set up; KOSMOS_TESTS_REAL_SCHTASKS=1 runs against the real Task Scheduler" >&2
        exit 2
      fi
      echo "run-tests: schtasks calls reach this computer's REAL Task Scheduler (#7247; CI or KOSMOS_TESTS_REAL_SCHTASKS=1 asked for it)" >&2
    else
      _rt_sched="$(node -e 'const w = require(process.argv[1]); const e = w.childEnv(process.env, "win32"); process.stdout.write((e.NODE_OPTIONS || "") + "\n" + (w.schedulerLine(process.env, "win32") || ""))' "$_rt_wt")" \
        || { echo "run-tests: could not read the #7247 schtasks rule from tools/windows-tests.js" >&2; exit 2; }
      _rt_opts="$(printf '%s\n' "$_rt_sched" | head -n 1)"
      if [ -n "$_rt_opts" ]; then export NODE_OPTIONS="$_rt_opts"; fi
      echo "run-tests: $(printf '%s\n' "$_rt_sched" | tail -n 1)" >&2
    fi ;;
esac
# #6791: which platform's share of test:shell a shard runs (tools/shell-macos-only.txt): linux or mac, only with a shard.
if [ -n "${KOSMOS_SHELL_PLATFORM:-}" ]; then
  if [ -z "${KOSMOS_SHELL_SHARD:-}" ] || { [ "$KOSMOS_SHELL_PLATFORM" != linux ] && [ "$KOSMOS_SHELL_PLATFORM" != mac ]; }; then
    echo "run-tests: KOSMOS_SHELL_PLATFORM must be linux or mac and only with KOSMOS_SHELL_SHARD (got platform '$KOSMOS_SHELL_PLATFORM', shard '${KOSMOS_SHELL_SHARD:-}')" >&2
    exit 2
  fi
fi
# #6977: KOSMOS_SHELL_CUT_ENV=1 runs the shell part in a cut's shape (tools/lib/cut-shape.sh: AGENT_WORKFORCE_HOME
# exported, and a stand-in live cut), so a shell test that fails only in a cut fails here instead of at step 3. CI only:
# the stand-in reads as a cut to every cut guard on the computer, so on a shared Mac it would hold up other agents.
case "${KOSMOS_SHELL_CUT_ENV:-0}" in
  0) ;;
  1) if [ "${GITHUB_ACTIONS:-}" != true ]; then
       echo "run-tests: KOSMOS_SHELL_CUT_ENV=1 is for CI only: its stand-in cut would read as a real cut to every other agent's suite and cut on this computer. To check one test by hand, use tools/lib/cut-shape.sh with a --base inside a kt<digits> folder." >&2
       exit 2
     fi ;;
  *) echo "run-tests: KOSMOS_SHELL_CUT_ENV must be 0 or 1 (got '$KOSMOS_SHELL_CUT_ENV')" >&2; exit 2 ;;
esac

# --- #6668: a wall-clock limit per test FILE, outside node ---------------------
# A test blocked in a sync call (spawnSync, execSync, execFileSync with no timeout) blocks its own event loop, so
# nothing inside node can stop it, --test-timeout included. One such grep held the machine's test queue for 66 min.
# So a watchdog beside the suite looks every few seconds at the DIRECT children of THIS run's `node --test` (scoped by
# parent pid: only this runner's own node --test and its direct children), and stops any child older than the limit,
# with its process tree (by parent pid: a descendant that was reparented or daemonised escapes it, and one re-parented
# to launchd during the 5 s grace is not KILLed): TERM, then KILL for whatever still runs 5 s later. The TERM targets
# come from one ps snapshot in which the root's parent is this run's node; its descendants are not rechecked one by
# one before the TERM, while the KILL targets are. A file is stopped, printed and flagged once. Behind a non-exec node
# shim it watches the shim's own node --test child instead.
# It prints `run-tests: TIMED OUT after <limit>: <file>` (minutes when whole, else seconds), and the run is red even
# if node reports 0 (a flag file, read after node exits). The limit: KOSMOS_TEST_FILE_TIMEOUT_MIN minutes (default 30:
# three times the slowest file estimated from summed per-test times under the incident's load, about 10 min, and 4.6x
# the slowest file sampled in a full run on 2026-10-20, 388 s at mean load 18.7; see
# .claude/plans/filewatchdog-6668.md), scaled by KOSMOS_TEST_TIME_SCALE like the other liveness ceilings but never
# past 60 min by the scaling: the point is to bound how long one node test file can hold the shared queue (an N set
# above 60 is taken as given). KOSMOS_TEST_FILE_TIMEOUT_S, in seconds and unscaled, is for this runner's own tests.
# Both refuse a leading 0 (bash would read 010 as octal) and more than a day (1440 min, 86400 s).
# KOSMOS_TEST_TIMEOUT_MS overrides node's per-test --test-timeout (default 600000, scaled below by
# KOSMOS_TEST_TIME_SCALE like the suite's other liveness ceilings); validated the same way.
RT_FILE_TIMEOUT_MIN="${KOSMOS_TEST_FILE_TIMEOUT_MIN:-30}"
# (Never empty here: an empty KOSMOS_TEST_FILE_TIMEOUT_MIN means the default, by the :- above.)
case "$RT_FILE_TIMEOUT_MIN" in *[!0-9]*|0*) echo "run-tests: KOSMOS_TEST_FILE_TIMEOUT_MIN must be a whole number of minutes above 0, with no leading 0 (got '$RT_FILE_TIMEOUT_MIN')" >&2; exit 2 ;; esac
[ "${#RT_FILE_TIMEOUT_MIN}" -le 4 ] && [ "$RT_FILE_TIMEOUT_MIN" -le 1440 ] || { echo "run-tests: KOSMOS_TEST_FILE_TIMEOUT_MIN must be at most 1440 (a day; got '$RT_FILE_TIMEOUT_MIN')" >&2; exit 2; }
if [ -n "${KOSMOS_TEST_FILE_TIMEOUT_S:-}" ]; then
  case "$KOSMOS_TEST_FILE_TIMEOUT_S" in *[!0-9]*|0*) echo "run-tests: KOSMOS_TEST_FILE_TIMEOUT_S must be a whole number of seconds above 0, with no leading 0 (got '$KOSMOS_TEST_FILE_TIMEOUT_S')" >&2; exit 2 ;; esac
  [ "${#KOSMOS_TEST_FILE_TIMEOUT_S}" -le 5 ] && [ "$KOSMOS_TEST_FILE_TIMEOUT_S" -le 86400 ] || { echo "run-tests: KOSMOS_TEST_FILE_TIMEOUT_S must be at most 86400 (a day; got '$KOSMOS_TEST_FILE_TIMEOUT_S')" >&2; exit 2; }
fi
if [ -n "${KOSMOS_TEST_TIMEOUT_MS:-}" ]; then
  case "$KOSMOS_TEST_TIMEOUT_MS" in *[!0-9]*|0*) echo "run-tests: KOSMOS_TEST_TIMEOUT_MS must be a whole number of milliseconds above 0, with no leading 0 (got '$KOSMOS_TEST_TIMEOUT_MS')" >&2; exit 2 ;; esac
  [ "${#KOSMOS_TEST_TIMEOUT_MS}" -le 9 ] || { echo "run-tests: KOSMOS_TEST_TIMEOUT_MS must be at most 9 digits (got '$KOSMOS_TEST_TIMEOUT_MS')" >&2; exit 2; }
fi
# $1 and every process under it, by parent pid, from ONE `ps` snapshot; nothing unless $1 is running AND its parent
# in that same snapshot is $2 (this run's node), so the scoping and the walk read the same instant.
rt_wd_tree() {
  ps -A -o pid=,ppid= 2>/dev/null | awk -v root="$1" -v want="$2" '
    { kids[$2] = kids[$2] " " $1; up[$1] = $2 }
    END { if (!(root in up) || up[root] != want) exit
          q[1] = root; n = 1; for (i = 1; i <= n; i++) { print q[i]; c = split(kids[q[i]], k, " "); for (j = 1; j <= c; j++) q[++n] = k[j] } }'
}
# The loop itself, run in the background: $1 this runner's pid, $2 the flag file.
rt_wd_loop() {
  local parent="$1" flag="$2" node="" tick=5 p f cmd kids old pid file victims alive fresh
  local sl="" stop=0 looks=0 stopped="" ent
  [ "$RT_FILE_TIMEOUT_S" -lt 30 ] && tick=1
  # A TERM from rt_file_watchdog_stop ends the loop at once: the tick is a BACKGROUND sleep plus wait, which the trap
  # interrupts. The grace sleeps (the up to 5 s between TERM and KILL) are foreground, so the trap runs after the one
  # in progress; the file loop then checks stop before each file and before the KILL, and stops there. So a stop
  # during a grace skips that KILL: a file that ignored the TERM can outlive a run whose node has already exited.
  trap 'stop=1; [ -n "${sl:-}" ] && kill "$sl" 2>/dev/null' TERM
  while [ "$stop" = 0 ] && kill -0 "$parent" 2>/dev/null; do
    if [ -z "$node" ]; then
      for p in $(pgrep -P "$parent" 2>/dev/null); do
        cmd="$(ps -ww -o command= -p "$p" 2>/dev/null)"
        case "$cmd" in "node --test "*|*"/node --test "*) node="$p" ;; esac   # by name, or by full path
      done
      # Found: say so beside the flag, so the record beside a red can tell "not found" from a limit that held.
      [ -n "$node" ] && : > "$flag.node"
      looks=$((looks + 1))
      # Looks come every 0.2 s until node is found, so a short run is seen too. node starts right after this loop
      # does, so 25 looks (5 s or more: each look also runs ps) without it means it is not where this looks; a node
      # that slow to start under load can print this on a green run too.
      if [ -z "$node" ] && [ "$looks" = 25 ]; then
        echo "run-tests: node --test not found yet; the per-file limit is off until it is (#6668)" >&2
      fi
    elif ! kill -0 "$node" 2>/dev/null; then
      # $node itself is only rechecked with kill -0: a pid reused in the microseconds after node exits is not covered.
      return 0
    else
      # A non-exec node shim (Volta and similar): the runner's child reads as node --test but only starts the real
      # one as its child and waits. When this node --test's ONLY child is itself a node --test (by command line, and
      # by parent pid as everywhere here), watch that one instead, so a file and not the whole suite meets the limit.
      # It relies on a per-file child's command line never containing "node --test " (Node 26 starts each file as
      # node --test-concurrency=...), so a real node --test with one file is not mistaken for a shim.
      kids="$(pgrep -P "$node" 2>/dev/null)"
      if [ -n "$kids" ] && [ "$(printf '%s\n' "$kids" | wc -l | tr -d ' ')" = 1 ]; then
        cmd="$(ps -ww -o command= -p "$kids" 2>/dev/null)"
        case "$cmd" in "node --test "*|*"/node --test "*) node="$kids"; continue ;; esac
      fi
      # Direct children of node --test older than the limit. etime is [[dd-]hh:]mm:ss of WALL clock, so a host
      # sleep or suspend counts as test time and can produce a TIMED OUT red (known limit; fleet Macs do not sleep).
      # Each is printed as pid@start (its start time, lstart, from the same snapshot), so "once per file" below is
      # keyed on the process, not on a pid that a long run may hand to a new process later.
      old="$(ps -A -o pid=,ppid=,etime=,lstart= 2>/dev/null | awk -v n="$node" -v lim="$RT_FILE_TIMEOUT_S" '
        $2 == n { e = $3; d = 0; if (index(e, "-")) { split(e, a, "-"); d = a[1]; e = a[2] }
                  c = split(e, t, ":"); s = 0; for (i = 1; i <= c; i++) s = s * 60 + t[i]
                  if (d * 86400 + s >= lim) print $1 "@" $4 "-" $5 "-" $6 "-" $7 "-" $8 }')"
      # One at a time: several files over the limit on the same look are each stopped in turn, so each can wait
      # up to the 5 s TERM grace of the ones before it.
      for ent in $old; do
        [ "$stop" = 0 ] || break
        pid="${ent%%@*}"
        # Each file once: one that outlived its KILL (or lingers unreaped) is not TERMed, printed or flagged again.
        # Keyed on pid and start time, so a new process that reuses an old pid is still seen.
        case "$stopped " in *" $ent "*) continue ;; esac
        cmd="$(ps -ww -o command= -p "$pid" 2>/dev/null)" || continue
        # node --test starts each file with the file as its LAST argument: name it by the longest file of this
        # run that the command line ends with (so a path with a space survives), else by the last word (which is
        # also what a run with arguments after the files gets, since then no file ends the command line).
        file="${cmd##* }"; p=""
        for f in "${KOSMOS_TEST_FILES[@]}"; do
          case "$cmd" in *" $f"|*"/$f") [ "${#f}" -gt "${#p}" ] && p="$f" ;; esac
        done
        [ -n "$p" ] && file="$p"
        # The TERM targets come from ONE ps snapshot in which the root's parent is this run's node: a root pid that
        # ended and was reused since the look above gives nothing. Its descendants are not rechecked one by one
        # before the TERM (a pid reused in those microseconds is not covered); the KILL targets below are rechecked.
        victims="$(rt_wd_tree "$pid" "$node")"
        # Gone (or no longer node's) between the age check and the walk: it timed nothing out.
        [ -n "$victims" ] || continue
        stopped="$stopped $ent"
        kill -TERM $victims 2>/dev/null
        echo "run-tests: TIMED OUT after $RT_FILE_TIMEOUT_LABEL: $file (#6668; stopped it and its process tree)" >&2
        printf '%s\n' "$file" >> "$flag"
        for p in 1 2 3 4 5 6 7 8 9 10; do kill -0 $victims 2>/dev/null || break; sleep 0.5; done   # up to 5 s
        [ "$stop" = 0 ] || break
        # KILL, from one fresh ps, only a pid that is running now AND either was in the first snapshot with its
        # current parent also in that snapshot, or is in a fresh walk from the root, which gives nothing unless the
        # root is still a child of this node in that walk's own snapshot (so the root itself is KILLed only that
        # way). A pid reused in those 5 s by an unrelated process fails both (reasoned: not proven by a test). Not
        # covered: a first-snapshot process whose parent died and that was adopted by launchd is left running.
        fresh="$(rt_wd_tree "$pid" "$node")"
        alive="$(ps -A -o pid=,ppid= 2>/dev/null | awk -v first=" $(echo $victims) " -v fresh=" $(echo $fresh) " '
          { me = " " $1 " "; up = " " $2 " "
            if (index(fresh, me) || (index(first, me) && index(first, up))) print $1 }')"
        [ -n "$alive" ] && kill -KILL $alive 2>/dev/null
      done
    fi
    [ "$stop" = 0 ] || break
    if [ -z "$node" ] && [ "$looks" -lt 25 ]; then sleep 0.2 & sl=$!; else sleep "$tick" & sl=$!; fi
    # A stop that landed between the check above and sl=$! found no sleep to kill: kill it here.
    [ "$stop" = 0 ] || { kill "$sl" 2>/dev/null; break; }
    wait "$sl" 2>/dev/null; sl=""
  done
}
rt_file_watchdog_start() {
  [ "$KOSMOS_TEST_PART" != shell ] || return 0
  # Beside the run root, not in it: the tests get the run root as TMPDIR, so none of them can touch the flag. When no
  # run root exists it lands in TMPDIR itself, which the tests then share. A signal in the microseconds between mktemp
  # creating the file and this assignment leaves it behind (the traps remove only a flag they can name).
  _rt_wd_flag="$(mktemp "$(dirname "$KOSMOS_RUN_TMPDIR")/kt$$-file-timeout.XXXXXXXXXX")" || { echo "run-tests: could not make the file watchdog's flag file; running without a per-file limit (#6668)" >&2; _rt_wd_flag=""; return 0; }
  rt_wd_loop "$$" "$_rt_wd_flag" &
  _rt_wd_pid=$!
  _rt_wd_started=1
  # On a TERM to the runner, its EXIT trap signals the watchdog at once (both traps name _rt_wd_pid and remove the
  # flag), not only at the loop's next look at its parent. On a Ctrl-C, bash waits for node and the normal stop
  # (rt_file_watchdog_stop) follows. The trap for a run with no run root is not proven by a test.
  # ⚠️ A TERMed runner leaves its node --test running without the per-file limit (bash exits at once and node is not
  # its signal's target): stop the inner node too. The runner's TERM behaviour is deliberately unchanged here.
}
# After node: stop the loop, and a file it timed out makes the run red whatever node said (that backstop for a node
# that reports 0 is not proven by a test: node already fails a killed file).
rt_file_watchdog_stop() {
  [ -n "$_rt_wd_pid" ] && { kill "$_rt_wd_pid" 2>/dev/null; wait "$_rt_wd_pid" 2>/dev/null; }
  _rt_wd_pid=""
  [ -n "$_rt_wd_flag" ] || return 0
  [ -e "$_rt_wd_flag.node" ] && _rt_wd_found=1
  if [ -s "$_rt_wd_flag" ]; then
    echo "run-tests: $(wc -l < "$_rt_wd_flag" | tr -d ' ') test file(s) ran longer than $RT_FILE_TIMEOUT_LABEL and were stopped (#6668):" >&2
    sed 's/^/  /' "$_rt_wd_flag" >&2
    [ "$NODE_STATUS" -eq 0 ] && NODE_STATUS=1
  fi
  rm -f "$_rt_wd_flag" "$_rt_wd_flag.node"; _rt_wd_flag=""
}

# #2858: strip the ambient Codex-home vars ONCE here, at the single runner every
# `yarn test` (and the canonical validation / pre-challenge gate) routes through,
# so the whole suite -- node AND test:shell, every test including ones not
# yet written -- is isolated from whoever invoked it. Invoking the suite from a
# Codex (gpt) agent's session inherits that agent's live CODEX_HOME (e.g.
# /Users/<u>/.codex-work2), and the tests that read it (server.create-live-1903,
# server.openai-badge-2413, openaiaccounts.delete-primary-2684) then read real
# agent state and RED with 17 false failures. BOTH names are stripped on purpose:
# the current leak is through the bare CODEX_HOME, while #1412's outward-
# contamination fix routes through the sandboxed AGENT_WORKFORCE_CODEX_HOME --
# stripping only one leaves the other path open. This guards the BOUNDARY once,
# rather than patching each test (#1412 was the same boundary fixed per-test, and
# the class re-opened two weeks later through different tests). A test that needs a
# Codex home sets its OWN (a sandbox path) inside the test, so removing the
# inherited ambient value cannot break it. `unset` of an already-unset var is a
# no-op under `set -u`, and nothing in this runner reads either var.
unset CODEX_HOME AGENT_WORKFORCE_CODEX_HOME
# #4491 slice 7, the same boundary for the same reason: an agent launched with KOSMOS_AGENT_TOKEN_ONLY=1 (and every
# agent carries a KOSMOS_AGENT_TOKEN) would make each CLI test that spreads process.env stop sending the board
# token, and five tests that expect it went red (measured). A test that wants the switch sets it itself.
unset KOSMOS_AGENT_TOKEN_ONLY
# #5933, the same boundary for the agent's identity itself: since #5898 every agent's launcher passes
# KOSMOS_AGENT_TOKEN and KOSMOS_AGENT_SESSION, and install/kosmos treats a process carrying either as an agent
# that presents its token. A CLI test that spreads process.env then presents a token its sandbox board never
# issued and is refused (server.subtasks-3861: three reds, measured, in an agent's own validation and none in
# CI). Every test that wants either variable sets its own.
unset KOSMOS_AGENT_TOKEN KOSMOS_AGENT_SESSION
# #5073, the same boundary for the caller's locale: with none, tmux replaces its field tabs and every test that reads
# tmux goes red for that alone (the 0.7.19 re-cut, launched through `tmux run-shell`, had no LANG). The rules are in
# the lib; a lib that is missing fails loud here rather than skipping the pin.
. "$REPO/tools/lib/test-locale.sh" || { echo "run-tests: tools/lib/test-locale.sh is missing" >&2; exit 1; }
kosmos_test_locale_pin

# #708: label a live board's cwd as the main checkout / a worktree / neither.
# Sourced HERE rather than beside the cut-guard source below, because
# seen_before() runs before that point. Fail-open exactly like that one: if the
# lib is missing the function is undefined and the caller falls back to the bare
# path, which is what this file printed before #708.
. "$REPO/tools/lib/board-origin.sh" 2>/dev/null || true
# #2750: the 1-minute load in seen_before()'s banner is read through
# kosmos_box_load_1min (the one owner of "field 2 of vm.loadavg is the 1-min
# load"), rather than a second inline copy of that fact. Sourced HERE beside
# board-origin, and for the same reason: seen_before() runs before the cut-guard
# source below. Same fail-open contract -- if the lib is missing the function is
# undefined and seen_before falls back to omitting the load line.
. "$REPO/tools/lib/cut-load-guard.sh" 2>/dev/null || true

# #2439 fleet-safety: disable the one-time AgentWorkforce -> Kosmos migration for the
# WHOLE suite. That migration is triggered by store.root(), so ANY test that reaches
# store.root() without first setting its own sandbox would RENAME the operator's REAL
# store (measured: it split the live fleet store, and a re-merge was undone by the next
# test run). This opt-out (honored by engine/store.js maybeMigrateLegacyStore) stops the
# destructive rename during tests while a real end-user install, which never sets it,
# still migrates. It is the migration only -- it does not sandbox DATA/PROJECTS/WORKERS
# etc., so it does not trip the board's #634 "half-sandboxed" refusal. The migration
# test clears it per-arm so its sandboxed arms still exercise the rename; tests that
# seed a fixture do so under the CURRENT leaf (store.APP) rather than relying on the
# migration to relocate a legacy seed.
export KOSMOS_NO_LEGACY_MIGRATION=1
# #5418: marks every process this run starts (node and shell tests alike) as a test, so
# engine/store.js never hands any of them this machine's REAL data root (a throwaway store
# root instead). A step that must read the real store says KOSMOS_ALLOW_REAL_ROOT=1. (node
# --test marks its own files with NODE_TEST_CONTEXT; this covers the shell tests and anything
# they start.) It is exported BELOW, once TMPDIR is this run's own, and its value is that
# folder: store.js honours it only in a process whose temp folder is inside it, so the same
# variable left in some shell does not turn a real board into a test.

# #4253: no board a test boots may phone home. A sandboxed board mints a fresh install id,
# so each boot sent installkosmos.com a new install (count 0, darwin) and inflated the
# public install count by thousands a day. The beacon itself is untouched (Josh's 09-14
# ruling: the real install ping is never removed or made opt-out-able); only this
# harness points it, and the daily report, at a dead local port.
export AGENT_WORKFORCE_CREATED_URL=http://127.0.0.1:9/api/created
export AGENT_WORKFORCE_FEEDBACK_URL=http://127.0.0.1:9/api/feedback
export AGENT_WORKFORCE_COMMUNITY_URL=http://127.0.0.1:9/
export KOSMOS_UPDATE_PAUSE_URL=http://127.0.0.1:9/v1/meta   # kosmos#6620: the update pause asks a dead port, never the coordinator
export AGENT_WORKFORCE_PERSON_LOCALE=en   # #5050: a test that inherits this env writes no language block, whatever this Mac's language is
# #4632: the roles and teams catalogue a board downloads when asked (the picker, `kosmos agent
# roles`, a create for a role it does not hold). A test that needs it serves its own.
export KOSMOS_CATALOGUE_BASE=http://127.0.0.1:9/
# kosmos#6756: no test waits behind a real relay pre-push build. A test that runs queued-heavy.sh or release.sh would
# otherwise read this machine's real build lock (~/.cache/prepush/machine.lock) and wait out a live cargo step until its
# own deadline. A path under /dev/null can never exist, so the probe answers "no build"; a test of the wait sets its own.
export KOSMOS_PREPUSH_MACHINE_LOCK=/dev/null/kosmos-tests-no-prepush-lock

# #4326: no test may run the operator's real gh or vercel. A board a test boots probes them
# for /api/connections, and an unauthenticated `vercel whoami` waits forever (one ran 2h39m at
# ~600 MB on 2026-09-28). Default both to a fake that answers "signed out" at once; a test that
# needs another answer sets its own. test-support/tool-guard.js (preloaded below) fails any
# test that still reaches a real one.
export AGENT_WORKFORCE_GH_BIN="$REPO/test-support/fake-cli-signed-out.sh"
export AGENT_WORKFORCE_VERCEL_BIN="$REPO/test-support/fake-cli-signed-out.sh"

# --- what the machine was doing, taken before the first test ---------------
seen_before() {
  local lines=()
  # A live board on the default port, with whose it is: cwd says whether it is
  # the main checkout (#708's deliberate one) or a worktree.
  local pid cwd
  for pid in $(lsof -nP -iTCP:16180 -sTCP:LISTEN -t 2>/dev/null); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    # #2515: the board's CODE tree, not its cwd, is what #708 exists to name. The
    # installed board runs `node server.js` with cwd $HOME, so keying on cwd
    # reported the single most consequential main-checkout board as an ordinary
    # $HOME directory. Resolve the code tree from the process argv (`ps -o args=`;
    # `lsof -d txt` gives the node interpreter, not the script -- measured), and
    # classify THAT. Empty when the argv names no .js script (an installed-bundle
    # `kosmos start` shape), so the label falls back to the cwd rather than guess.
    local codedir=""
    if command -v board_code_dir_from_args >/dev/null 2>&1; then
      codedir="$(board_code_dir_from_args "$(ps -p "$pid" -o args= 2>/dev/null)" "$cwd")"
    fi
    # 🛑 `local where` on its own line is an ANCHOR: tools/test-board-origin.sh
    # extracts this guard block with awk between /^ *local where$/ and /^ *fi$/ and
    # executes it, so the fail-open path is tested against these bytes rather than
    # a copy. The block keys on ${codedir:-$cwd} and the test drives it with both
    # vars set; the codedir resolution above stays OUTSIDE the extracted range.
    # It fails loudly rather than silently, but it is a real coupling.
    local where
    if command -v board_origin_label >/dev/null 2>&1; then
      where="$(board_origin_label "${codedir:-$cwd}")"
    else
      where="${codedir:-${cwd:-an unknown directory}}"
    fi
    # The cwd is worth printing only when it is a DIFFERENT tree than the code:
    # on this machine they disagree (code = the checkout, cwd = $HOME), and that
    # disagreement is itself the interesting fact. board_cwd_note handles the
    # empty/equal cases (returns nothing), so append it unconditionally.
    command -v board_cwd_note >/dev/null 2>&1 && where="$where$(board_cwd_note "$codedir" "$cwd")"
    lines+=("a live board on :16180, pid $pid, running from $where")
  done
  # Page gates running beside this: each holds a kosmos-bc.* dir in TMPDIR
  # that it touches as it goes. Counted by RECENT modification, not by
  # existence: the first version of this counted every such dir and reported
  # 200 gates running, which were 200 leaked sandboxes from a cleanup that
  # never ran (fixed the same hour in browser-checks.sh).
  local gates
  gates="$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'kosmos-bc.*' -mmin -15 2>/dev/null | wc -l | tr -d ' ')"
  [ "${gates:-0}" -gt 0 ] && lines+=("$gates browser-check sandbox(es) touched in the last 15 minutes, so a page gate was probably running")
  # Load against cores: a stalled spawn (#704) is what a high number looks like.
  # #2750: read the 1-min load through the shared kosmos_box_load_1min rather than
  # a second inline `sysctl | awk '{print $2}'`. `command -v` guarded (matching
  # board_cwd_note above) so a missing lib just omits the line, and load is
  # pre-initialised for `set -u` since the guard may leave it unassigned.
  local load="" cores=""
  command -v kosmos_box_load_1min >/dev/null 2>&1 && load="$(kosmos_box_load_1min)"
  command -v kosmos_cpu_count >/dev/null 2>&1 && cores="$(kosmos_cpu_count)"
  [ -n "$load" ] && lines+=("1-minute load $load on ${cores:-?} cores")
  # #5727: the wall-clock time-scale the eventually() helper applies this run, so the
  # reader of a timing red sees whether budgets were stretched for load (scale > 1x).
  [ -n "${KOSMOS_TEST_TIME_SCALE:-}" ] && lines+=("wall-clock test time-scale ${KOSMOS_TEST_TIME_SCALE}x")
  printf '%s
' "${lines[@]}"
}
# #5727: compute ONE wall-clock time-scale for the whole suite, HERE and ONCE (the
# 1-minute load moves between reads -- #2749), BEFORE seen_before so the banner shows
# it. test-support/eventually.js reads KOSMOS_TEST_TIME_SCALE to scale each poll budget
# by the box's load-per-core; the floor 1 / cap 4x and the per-core math live in the
# lib, so this always sets a well-formed value in [1.00, 4.00]. Computed, never taken
# pre-set: the knob for reproducing a load-driven flake locally is KOSMOS_FAKE_LOAD
# (cut-load-guard.sh honors it), which feeds the SAME clamped math, so a forced scale
# cannot bypass the guardrails or print garbage in the banner. cut-load-guard.sh
# (kosmos_box_load_1min) is sourced above; the lib falls back to sysctl if it is not.
. "$REPO/tools/lib/test-time-scale.sh" 2>/dev/null || true
if command -v kosmos_test_time_scale >/dev/null 2>&1; then
  KOSMOS_TEST_TIME_SCALE="$(kosmos_test_time_scale)"
else
  KOSMOS_TEST_TIME_SCALE=1.00
fi
export KOSMOS_TEST_TIME_SCALE
# #6668: node's per-test --test-timeout, a liveness ceiling, scaled like the others (600000 = 3.3x an estimated
# lower bound, 183.5 s from log lines; see plan), rounded to a whole ms (the scale has two decimals, so it is
# exact). KOSMOS_TEST_TIMEOUT_MS (validated above) is taken as given.
# The per-file limit, scaled the same way, but never past 60 min by the scaling (an N set above 60 stays as set):
# it bounds how long one file can hold the shared queue. KOSMOS_TEST_FILE_TIMEOUT_S is taken as given.
if [ -n "${KOSMOS_TEST_FILE_TIMEOUT_S:-}" ]; then
  RT_FILE_TIMEOUT_S="$KOSMOS_TEST_FILE_TIMEOUT_S"
else
  RT_FILE_TIMEOUT_S="$(awk -v n="$RT_FILE_TIMEOUT_MIN" -v s="$KOSMOS_TEST_TIME_SCALE" 'BEGIN { b = n * 60; v = b * s
    if (v < b || v != v) v = b; c = (b > 3600) ? b : 3600; if (v > c) v = c; printf "%d", v + 0.5 }')"
fi
if [ $((RT_FILE_TIMEOUT_S % 60)) = 0 ]; then RT_FILE_TIMEOUT_LABEL="$((RT_FILE_TIMEOUT_S / 60)) min"; else RT_FILE_TIMEOUT_LABEL="$RT_FILE_TIMEOUT_S s"; fi
RT_TEST_TIMEOUT_MS="${KOSMOS_TEST_TIMEOUT_MS:-$(awk -v s="$KOSMOS_TEST_TIME_SCALE" 'BEGIN { v = 600000 * s; if (v < 600000 || v != v) v = 600000; printf "%d", v + 0.5 }')}"
BEFORE="$(seen_before)"

# #1962: refuse to run the suite while a RELEASE holds the machine. This is every
# agent's pre-PR validation and the ordinary tenant a cut's hold list kept missing
# -- and a concurrent gate is exactly what turns a green suite red (measured: the
# same file, 8 reds under contention, 22/22 alone). The consult is FAIL-OPEN and
# cookie-excluded: a broken/absent claim file never refuses, and a cut's OWN
# `yarn test` (which inherits the claim cookie via the env) self-excludes and runs
# -- only a live, unexpired, FOREIGN claim refuses. CI is unaffected: the claim
# lives at ~/.cache on the reserving Mac, which a GitHub runner does not have.
# KOSMOS_IGNORE_MACHINE_CLAIM=1 runs anyway; who holds it: tools/who-has-the-box.sh.
# The library LOAD is itself fail-open, so this whole feature can never turn a
# missing/unreadable lib into a refused suite: if the source fails, the function
# is undefined, `command -v` is false, and the run proceeds exactly as before
# #1962. Only a successfully-loaded guard that finds a live foreign claim refuses.
# (release.sh sources the same lib UNguarded and under set -e, deliberately: there,
# a lib it cannot load SHOULD abort the cut. Here the safe direction is to run.)
. "$REPO/tools/lib/cut-guard.sh" 2>/dev/null || true
# #4609 review: a full suite queues HEAVY whatever it inherited. A KOSMOS_QUEUE_CLASS=light exported in a shell, or
# inherited from a light queue turn, would otherwise let it jump the light lane and hold the box 15 to 20 minutes.
# #5272: the one exception is the main canary (KOSMOS_QUEUE_CLASS=canary), a full suite on main's tip that waits first
# among waiters, one canary at a time (tools/lib/cut-guard.sh). The next line stays as it is: a test strips it.
_rt_class_in="${KOSMOS_QUEUE_CLASS:-}"
KOSMOS_QUEUE_CLASS=heavy
[ "$_rt_class_in" = canary ] && KOSMOS_QUEUE_CLASS=canary
# #4498 (Kano's review, Liu Kang m3015): the claim is asked INSIDE _rt_box_clear below, on every poll, not once
# here. Asked once, a suite already waiting when a cut claimed the box could start inside the cut. Now a claim is a
# reason to wait, and the wait names the release; at the wait's bound the run refuses with that message.
# #4410: nor beside a live install harness (tools/test-install.sh). It boots real boards on test
# ports and checks that they let go of them; a suite started 3 minutes into one, both behind a
# clear heavy-gate, reddened its port checks (Kano, 2026-09-28). Fail-open on the library load,
# as above. A harness only a unit test started (the #4259 fixture rule) does not count.
# test-install.sh asks the mirror question (kosmos_refuse_if_suite_live) before it starts.
# A cut's own suite (it holds the live claim) stands down: the cut asked at its start, and its own
# install gate runs only after this suite ends.
# #4498: nor beside more than KOSMOS_SUITE_MAX - 1 other suites (#6334; three full suites overlapped
# on Mortals on 2026-09-28, because plain `heavy-gate --twice` does not count a suite). A suite inside a test (a node --test ancestor or
# the kt sandbox, the #4259 fixture rule) is part of the suite that started it, not a second one.
# Both checks WAIT rather than refuse: every 30 s, in a queue so the oldest waiting suite goes
# first, giving up when no waiter ahead has left for 105 minutes, whatever the blocker, and in any
# case after four bounds plus one per waiter ahead at entry (#4574; tools/lib/cut-guard.sh,
# kosmos_wait_until_clear). A run that skips the suite check (the override or a run inside a test,
# below) does not queue, and waits 20 minutes from its start. KOSMOS_NO_WAIT=1
# refuses at once; this runner's arguments all go to node --test (with a leading --only, the named files replace the suite list and
# nothing else is passed through), so it has no --no-wait flag.
# Whether this run asks about other suites at all is decided once: the override and the inside-a-test rule skip the
# suite check AND the queue (review 1), so neither can wait behind a waiting suite either.
# #6334: up to KOSMOS_SUITE_MAX suites at once (default 2), so this run starts beside one other. Measured 2026-10-16 on
# the 12-core Mac: two full suites side by side on one commit both passed (21287 tests, 0 failures, shell stages too),
# about 34 minutes each against 30 alone; that one pair, with nothing else running beside it, showed no port fight. Only
# this suite-beside-suite check reads it: an install harness and a queued-heavy turn still wait until no suite runs,
# which beside a staggered pair can take longer than beside one suite (their own bound still applies). A release cut
# asks about no suite at all: its claim stops new ones, and up to KOSMOS_SUITE_MAX already running finish beside it.
# KOSMOS_SUITE_MAX is read for THIS run's start only (KOSMOS_SUITE_MAX=1: this run waits until no other suite runs;
# a later run reading the default can still start beside it, so it does not keep the Mac to itself). Unset or empty is 2. A value must be 1 to 3 digits and not 0; anything else
# reads as 1 (so 0003 is 1). 999 lets this run start beside up to 998 others; the file below, when present, still caps it.
# The Mac-wide cap is a file, suite-max in the run-marker dir (~/.cache/kosmos-run-markers/suite-max), read by every
# run that has this code, whatever its own tree: `echo 1 > ~/.cache/kosmos-run-markers/suite-max` puts them all back to
# one at a time without a rebase. It can only lower the limit; unreadable or junk reads as 1.
_rt_suite_max_of() {   # <value> -> a whole number from 1 to 999 ("08" is not octal; 0 and junk read as 1)
  local v="$1"
  case "$v" in ''|*[!0-9]*|????*) v=1 ;; esac
  v=$((10#$v)); [ "$v" -ge 1 ] || v=1
  printf '%s' "$v"
}
# The variable is read once here (it is unset before the tests); the file is read again on every poll of the wait
# (_rt_box_clear), so a run already queued obeys a cap written while it waits.
_rt_suite_own_max="$(_rt_suite_max_of "${KOSMOS_SUITE_MAX:-2}")"
_rt_suite_max_now() {
  local m="$_rt_suite_own_max" f cap
  if command -v _kosmos_marker_dir >/dev/null 2>&1; then
    f="$(_kosmos_marker_dir)/suite-max"
    if [ -e "$f" ]; then
      cap="$(_rt_suite_max_of "$(head -1 "$f" 2>/dev/null | tr -d '[:space:]')")"
      if [ "$cap" -lt "$m" ]; then m="$cap"; fi
    fi
  fi
  printf '%s' "$m"
}
_rt_suite_check=1
{ [ "${KOSMOS_TESTS_IGNORE_SUITE:-0}" = 1 ] || _kosmos_pid_is_test_fixture "$$" "$0"; } 2>/dev/null && _rt_suite_check=0
# #7257: on Windows the live-suite and install-harness checks cannot answer: they read the process table with ps -A and
# pgrep, which Git Bash's ps does not take, so they exit "could not tell" and refuse every run. They are not run there.
_rt_harness_check=1
if [ "${_RT_WIN:-0}" = 1 ]; then
  _rt_suite_check=0; _rt_harness_check=0
  echo "run-tests: the live-suite and install-harness checks are not run on Windows (#7257: Git Bash's ps cannot answer them)" >&2
fi
_rt_box_clear() {
  kosmos_refuse_if_machine_claimed "this test run" || return 1
  if [ "$_rt_suite_check" = 1 ]; then
    kosmos_refuse_if_suite_live "this test run" "KOSMOS_TESTS_IGNORE_SUITE=1 runs anyway" "$(($(_rt_suite_max_now) - 1))" || return 1
  fi
  if [ "${KOSMOS_TESTS_IGNORE_HARNESS:-0}" != 1 ] && [ "$_rt_harness_check" = 1 ]; then
    kosmos_refuse_if_harness_live "this test run" "KOSMOS_TESTS_IGNORE_HARNESS=1 runs anyway" || return 1
  fi
  return 0
}
# #4911: inside a light run's SIDE turn (queued-heavy.sh --light beside a heavy run), refuse at once, a --only run
# too. A full run queued here would wait behind the heavy holder's claim while holding the side claim, which holds that
# holder's page layer too; a --only run would otherwise meet that claim (foreign to the side turn) and be refused in
# words about a release. A side turn runs its one file with node --test directly.
if command -v kosmos_holds_light_side >/dev/null 2>&1 && kosmos_holds_light_side; then
  echo "this test run is inside a light run's side turn (#4911): run-tests.sh, --only included, does not run beside the heavy run that holds the box. Run the file with node --test directly in the side turn, or take an ordinary turn: queued-heavy.sh without --light." >&2
  exit 2
fi
if [ "$KOSMOS_ONLY" = 1 ]; then
  # #4929: no queue wait, but a foreign machine claim and a live install harness still refuse, asked once (fail-open
  # on a missing lib, as above). A run that holds the claim's own KOSMOS_MACHINE_CLAIM_COOKIE is not refused by it
  # (tools.run-tests-only-4929.test.js).
  # Worded apart from the full suite's lines on purpose: tools/test-cut-guard.sh pins those by their text.
  if command -v kosmos_refuse_if_machine_claimed >/dev/null 2>&1; then
    if ! kosmos_holds_machine_claim; then
      kosmos_refuse_if_machine_claimed "this --only run" || exit 1
      if [ "${KOSMOS_TESTS_IGNORE_HARNESS:-0}" != 1 ] && [ "$_rt_harness_check" = 1 ]; then
        kosmos_refuse_if_harness_live "this --only run" "KOSMOS_TESTS_IGNORE_HARNESS=1 runs it anyway" || exit 1
      fi
    fi
  fi
elif command -v kosmos_wait_until_clear >/dev/null 2>&1 && ! kosmos_holds_machine_claim; then
  if [ "$_rt_suite_check" = 1 ]; then
    # #5332: KOSMOS_WAIT_KEEP_MARK is queued-heavy's alone (it unmarks after its take; this script never does). A leaked
    # one would keep this suite's marker for the whole run, and a waiter's process tree is dropped from the live-suite
    # check, so a harness could start beside it.
    unset KOSMOS_WAIT_KEEP_MARK
    kosmos_wait_until_clear "this test run" --suite-queue _rt_box_clear || exit 1
  else
    kosmos_wait_until_clear "this test run" _rt_box_clear || exit 1
  fi
fi
# #4609: the queue overrides and wait controls are for THIS run's wait, read above; nothing later in this script reads
# them. Its descendants lose them on purpose, a nested run-tests.sh in a test included (it waits on its own terms, and
# does not inherit an operator's KOSMOS_IGNORE_MACHINE_CLAIM either). Unset
# now, so no test this suite runs inherits them: an inherited KOSMOS_TESTS_IGNORE_SUITE made the #4498 queue tests' own
# run-tests.sh skip the queue and fail, and an inherited KOSMOS_NO_WAIT reds 19 of test-cut-guard.sh's arms (2026-09-29).
# The list lives in tools/lib/cut-guard.sh (KOSMOS_WAIT_CONTROL_VARS); a lib that failed to load leaves it empty and unsets nothing.
unset ${KOSMOS_WAIT_CONTROL_VARS:-}

# --- one temp root for this run, removed when it ends (#1151) -----------------
#
# 🛑 MEASURED: A FULL RUN LEAVES 92 DIRECTORIES IN TMPDIR AND REMOVES NONE.
# 61,953 entries had accumulated by 2026-08-28, and a sweep that deleted 12,356
# of them was fully refilled inside eight hours. The cost is COUNT, not bytes:
# 1.7 GB is nothing on this volume, ~60,000 directory entries is real.
#
# 🔑 WHY THIS IS ONE LINE HERE AND NOT 80 PATCHES. The refill spreads over 422
# distinct prefixes, of which the seven named on the card are 21% and the top
# twenty are 32%; it is ~80 call sites leaking one directory each, across 196
# `mkdtempSync` sites in 227 test files with no shared helper. Fixing them one
# at a time is the hand-kept-list shape that #1250 was about. Every test process
# inherits TMPDIR, so owning it here covers a call site nobody has written yet.
#
# ⚠️ AFTER `seen_before`, DELIBERATELY. That function counts concurrent page
# gates by looking for `kosmos-bc.*` in TMPDIR; moving this above it would point
# that count at an empty directory and report "no gates running" every time.
#
# 🛑 AND THE NAME IS SHORT ON PURPOSE. A macOS unix socket path is capped near
# 104 characters, tmux builds `$TMPDIR/tmux-<uid>/default`, and `engine/status`
# has a test that needs the ordinary "no server" error from a real tmux. Nesting
# the run under a long directory produced "File name too long" instead, which is
# a DIFFERENT error the board correctly refuses, and the test failed. The run root
# adds `/kt<pid>` (under ten characters), and a test file that also uses
# test-support/tmpscope.js adds `/kts-XXXXXX` on top (11 more): about TWENTY in all.
# Measured on Agent1s (a 48-character TMPDIR): 84 characters for the tmux socket. A
# machine whose TMPDIR leaves under about twenty characters of that limit has a
# fragile suite, which is #1264.
#
# 📌 A hard kill skips the trap and leaves ONE directory instead of 92, named
# for the run that made it, plus (#6668) the file watchdog's flag file beside it, kt<pid>-file-timeout.*,
# and (#7100) in a parallel shell part, the shard logs' folder kt-shellpar.* beside it.
#
# ⚠️ WHAT THIS DOES NOT COVER, MEASURED, BECAUSE THE OBVIOUS ASSUMPTION IS
# WRONG: macOS `mktemp` IGNORES TMPDIR. It reads the per-user directory from
# `confstr(_CS_DARWIN_USER_TEMP_DIR)` instead, so a shell test calling
# `mktemp -d` lands in the real temp root no matter what this exports. Verified
# by setting TMPDIR to two different values and getting /var/folders back both
# times. Node's `os.tmpdir()` DOES honour it, which is why this catches 91 of
# the 92. The four that remain are three `tmp.*` from shell tests and one yarn
# scratch dir, from the `yarn -s test:shell` this file ran before #5907. Those need
# their own cleanup at their own call sites; do not assume this line covers them.
KOSMOS_RUN_TMPDIR="${TMPDIR:-/tmp}"
KOSMOS_RUN_TMPDIR="${KOSMOS_RUN_TMPDIR%/}/kt$$"
if mkdir -p "$KOSMOS_RUN_TMPDIR" 2>/dev/null; then
  # #6668: this trap signals the file watchdog and removes its flag and .node files; in the moment before the
  # watchdog acts on the signal it can still write either one again, which this trap does not see (a stray file).
  # kosmos#4273: an INTERRUPTED run (Ctrl-C, a runner's timeout) never reaches the leak
  # guard, and removing the root under a launchd job loaded from a plist in it is the
  # 8,096-respawn shape. So while the labels snapshot is still unused (the guard removes
  # it), the trap boots out this run's jobs before the root goes.
  trap 'type kosmos_shell_parallel_stop >/dev/null 2>&1 && kosmos_shell_parallel_stop; [ -n "${_rt_ps_dir:-}" ] && rm -rf "$_rt_ps_dir"; [ -n "${_rt_wd_pid:-}" ] && kill "$_rt_wd_pid" 2>/dev/null; [ -n "${_rt_wd_flag:-}" ] && rm -f "$_rt_wd_flag" "$_rt_wd_flag.node"; [ -n "${_tl_labels_before:-}" ] && [ -f "$_tl_labels_before" ] && type leak_launchd_check >/dev/null 2>&1 && leak_launchd_check "$_tl_labels_before" "$KOSMOS_RUN_TMPDIR" >&2; rm -rf "$KOSMOS_RUN_TMPDIR"' EXIT
  export TMPDIR="$KOSMOS_RUN_TMPDIR"
  export KOSMOS_TEST_RUN="$KOSMOS_RUN_TMPDIR"   # #5418, see above
else
  # Never fail a run over housekeeping: the suite is what matters.
  echo "run-tests: could not make a per-run temp dir; the suite will use TMPDIR directly and leave its scratch behind" >&2
  # #5418: the marker is the temp folder in use, so this run's processes keep the real-root rule.
  export KOSMOS_TEST_RUN="${TMPDIR:-/tmp}"
  # #6668: with no run root there is no exit trap above, so this one signals the file watchdog on a TERM (a Ctrl-C
  # waits for node, and the normal stop follows).
  trap 'type kosmos_shell_parallel_stop >/dev/null 2>&1 && kosmos_shell_parallel_stop; [ -n "${_rt_ps_dir:-}" ] && rm -rf "$_rt_ps_dir"; [ -n "${_rt_wd_pid:-}" ] && kill "$_rt_wd_pid" 2>/dev/null; [ -n "${_rt_wd_flag:-}" ] && rm -f "$_rt_wd_flag" "$_rt_wd_flag.node"' EXIT
fi

# --- coverage assertion: every *.test.js is CONSIDERED (kosmos#1934) -----------
# The suite globs `engine/*.test.js *.test.js`. The naming convention uses DOTS as
# a pseudo-namespace at the ROOT -- `engine.reachable.test.js`, `install.banner.test.js`
# -- while a real `engine/` directory also exists. So `engine.X` (root) and `engine/X`
# (dir) coexist and read identically, and a path glob like `engine/*.test.js` matches
# only the files IN the directory and silently MISSES the far larger set at the root,
# INCLUDING the five named `engine.*` that most strongly imply they were included. That is
# exactly how a red `engine.reachable.test.js` sat under four merges: the pre-merge
# validation globbed
# `engine/*` and never saw the root file, and a glob matching a subset still exits 0 with
# a healthy tally. So gather the set ONCE and REFUSE TO RUN if it does not cover every
# *.test.js in the tree -- a narrowed glob, or a suite that lands in a new subdirectory,
# fails loudly with the count instead of passing green on a fraction. `find` prunes
# node_modules and .git -- the same set the durable test's walker skips, so the runtime
# guard and the test agree on what counts. If a real test dir beyond root/engine/ is ever
# added, update the glob here (the point of this guard is that you cannot forget to).
if [ "$KOSMOS_ONLY" = 1 ]; then
  # #4929: a second stop for an empty list. With no files, bash 5 expands an empty array cleanly and a bare node --test
  # discovers and runs EVERY *.test.js, so the refusal at the top must not be the only thing standing in the way.
  if [ "${#KOSMOS_ONLY_FILES[@]}" -eq 0 ]; then
    echo "run-tests: --only with no files would run the whole suite; refusing" >&2
    exit 2
  fi
  KOSMOS_TEST_FILES=("${KOSMOS_ONLY_FILES[@]}")   # #4929: the named files; the whole-suite count below does not apply
else
shopt -s nullglob
KOSMOS_TEST_FILES=(engine/*.test.js *.test.js)
shopt -u nullglob
_considered=${#KOSMOS_TEST_FILES[@]}
_exist=$(find . \( -name node_modules -o -name .git \) -prune -o -name '*.test.js' -print | wc -l | tr -d ' ')
# -ne, not -lt: any mismatch refuses, in BOTH directions. considered < exist is the main
# case (a glob missed some *.test.js). considered > exist means find did not descend a
# directory the shell glob did -- e.g. a symlinked engine/, which `find .` (no -L) skips
# while `engine/*.test.js` expands it -- which could otherwise net out a real stray and
# pass. Equality is the only safe state, and it holds today (382 == 382).
if [ "$_considered" -ne "$_exist" ]; then
  echo "run-tests: COVERAGE MISMATCH (kosmos#1934) -- the glob set is $_considered *.test.js but $_exist exist in the tree; they must match." >&2
  echo "  considered < exist: a path glob missed some *.test.js (a root suite, or one in a new subdirectory)." >&2
  echo "  The convention puts most suites at the ROOT with a dot (engine.reachable.test.js), which no engine/*" >&2
  echo "  glob matches; widen the glob above so it is considered. considered > exist: find did not descend a" >&2
  echo "  directory the glob did (e.g. a symlinked engine/); make the two agree. Canonical helper: yarn test." >&2
  exit 1
fi
fi

# --- #3011: snapshot the real ~/Library/LaunchAgents before the suite runs ----
# A test that creates agents without sandboxing AGENT_WORKFORCE_LAUNCH leaks a real
# com.kosmos.agent.* plist into launchd (phantom agents on the board). Snapshot the
# real set now; the leak check after the suite refuses any created or modified during
# it. Fail-soft: a snapshot failure leaves an empty baseline, never a false red here.
. "$REPO/tools/lib/launchagent-leak-guard.sh"   # $REPO, not $(dirname "$0"): a relative $0 no longer resolves after cd "$REPO" (#4929 review 17)
# $HOME here, while the #3605 guards use the account home: they agree unless HOME is redirected.
_la_guard_dir="${HOME}/Library/LaunchAgents"
_la_guard_before="$(mktemp "${TMPDIR:-/tmp}/la-leak-before.XXXXXXXXXX")" || _la_guard_before=""
[ -n "$_la_guard_before" ] && launchagent_snapshot "$_la_guard_dir" > "$_la_guard_before"

# --- #4273: what the suite leaves behind: launchd jobs, processes, temp entries -
# Snapshot the loaded launchd labels now; after the suite, lib/test-leak-guard.sh
# checks all three, each scoped to THIS run's temp root so a suite running beside
# another never blames or kills the other's. Only when the per-run root exists.
. "$REPO/tools/lib/test-leak-guard.sh"   # $REPO: as above
_tl_labels_before=""
if [ "${TMPDIR:-}" = "$KOSMOS_RUN_TMPDIR" ]; then
  _tl_labels_before="$(mktemp "$KOSMOS_RUN_TMPDIR/tl-labels.XXXXXXXXXX")" || _tl_labels_before=""
  [ -n "$_tl_labels_before" ] && leak_labels_snapshot > "$_tl_labels_before"
fi

# --- the suite ----------------------------------------------------------------
# Run the SAME set the coverage assertion counted, so the count and the run cannot drift.
# #3605: --require preloads a guard into EVERY file's process (node forwards it) that
# makes any fs write into the real ~/Library/LaunchAgents throw, so an unsandboxed test
# fails on its own line instead of leaking a job file launchd loads at the next login.
#
# #4317: which part runs is decided (and a bad value refused) at the top of this file.
# ⚠️ The node --test line stays FLUSH LEFT: three guards find the suite by `^node --test`
# (#1934's count-and-run pin, #3605's preload pin, #4273's guard-after-suite order).
#
# #6668: --test-timeout (10 min, scaled; per test, including its subtests; not per describe or per file) catches
# an async hang, but it runs on the test's own event loop, so it cannot stop a test blocked in a sync call
# (spawnSync with no timeout held the queue 66 min). The file watchdog below is outside node: it stops any one
# test FILE that runs longer than its limit and the run goes red.
#
# #6059: fresh-connections.js makes the global fetch open a new connection per request, so a kept-alive socket
# left idle on a loaded runner cannot come back ECONNRESET on the next request (one preload for ~240 files).
# #7257: Windows caps a command line at about 32K characters, so one node --test over every file stopped with
# "Argument list too long" and ran nothing. There, node is this function for the one call over KOSMOS_TEST_FILES: the
# same options and trailing arguments over the files in chunks of under 24,000 characters, in order, the worst exit
# status as the node part's, and one line naming the chunk count (so a run that did one chunk of many shows). Every
# other node call goes to node itself. The node --test line below stays as it is (three guards find it flush left).
# The per-file watchdog has never run on Windows (it reads ps -A and pgrep, which Git Bash lacks), chunked or not.
if [ "${_RT_WIN:-0}" = 1 ]; then
  node() {
    local n=${#KOSMOS_TEST_FILES[@]} k=-1 i
    local a=("$@")
    if [ "${1:-}" = --test ] && [ "$n" -gt 0 ]; then
      for ((i = 0; i + n <= ${#a[@]}; i++)); do
        if [ "${a[i]}" = "${KOSMOS_TEST_FILES[0]}" ] && [ "${a[i + n - 1]}" = "${KOSMOS_TEST_FILES[n - 1]}" ]; then k=$i; break; fi
      done
    fi
    if [ "$k" -lt 0 ]; then command node "$@"; return; fi
    local opts=("${a[@]:0:k}") extra=("${a[@]:k+n}") chunk=() base=0 len=0 worst=0 rc chunks=0 x f
    for x in "${opts[@]}" "${extra[@]}"; do base=$((base + ${#x} + 3)); done
    for f in "${KOSMOS_TEST_FILES[@]}"; do
      if [ "${#chunk[@]}" -gt 0 ] && [ $((base + len + ${#f} + 3)) -gt 24000 ]; then
        command node "${opts[@]}" "${chunk[@]}" "${extra[@]}"; rc=$?
        [ "$rc" -gt "$worst" ] && worst=$rc
        chunks=$((chunks + 1)); chunk=(); len=0
      fi
      chunk+=("$f"); len=$((len + ${#f} + 3))
    done
    command node "${opts[@]}" "${chunk[@]}" "${extra[@]}"; rc=$?
    [ "$rc" -gt "$worst" ] && worst=$rc
    chunks=$((chunks + 1))
    echo "run-tests: node --test ran in $chunks chunk(s) over $n file(s) (#7257: Windows caps a command line)" >&2
    return "$worst"
  }
fi
NODE_STATUS=0
_rt_wd_pid=""
_rt_wd_flag=""
_rt_wd_started=0
_rt_wd_found=0
rt_file_watchdog_start   # not for a shell-only run
if [ "$KOSMOS_TEST_PART" != shell ]; then
node --test --require "$REPO/test-support/launch-guard.js" --require "$REPO/test-support/tool-guard.js" --require "$REPO/test-support/fresh-connections.js" --test-timeout="$RT_TEST_TIMEOUT_MS" "${KOSMOS_TEST_FILES[@]}" "$@"
NODE_STATUS=$?
fi
rt_file_watchdog_stop
_rt_node_status="$NODE_STATUS"   # #6668: the node part's own verdict, before the shell part and the gates fold in
if [ "$KOSMOS_ONLY" = 1 ]; then
  :   # #4929: --only runs named node files; the shell part is the whole suite's
elif [ "$NODE_STATUS" -eq 0 ] && [ "$KOSMOS_TEST_PART" != node ]; then
  # #6977: in a cut's shape when KOSMOS_SHELL_CUT_ENV=1 (CI only, refused above). The scratch folder goes beside the kt
  # sandbox, not in it: a stand-in working there would be a test fixture to the cut guard and not count as a cut.
  # Only on a GitHub-hosted runner: a self-hosted one is a shared Mac (test.yml can route shell shards to it, #4601),
  # where the stand-in would read as a cut to every agent on it, and a runner that does not say counts as shared. The
  # part runs plain there, and says so.
  _rt_shell_wrap=()
  if [ "${KOSMOS_SHELL_CUT_ENV:-0}" = 1 ] && [ "${RUNNER_ENVIRONMENT:-}" != github-hosted ]; then
    echo "run-tests: KOSMOS_SHELL_CUT_ENV=1 is used only on a GitHub-hosted runner, not on '${RUNNER_ENVIRONMENT:-an unnamed runner}' (a shared computer); the shell part runs without the cut's shape (#6977)" >&2
  elif [ "${KOSMOS_SHELL_CUT_ENV:-0}" = 1 ]; then
    . "$REPO/tools/lib/cut-shape.sh"
    _rt_shell_wrap=(kosmos_cut_shape_run --base "$(dirname "$KOSMOS_RUN_TMPDIR")")
  fi
  if [ -n "${KOSMOS_SHELL_SHARD:-}" ]; then
    ${_rt_shell_wrap[@]+"${_rt_shell_wrap[@]}"} node "$REPO/tools/shell-shard.js" run "${KOSMOS_SHELL_SHARD%/*}" "${KOSMOS_SHELL_SHARD#*/}" ${KOSMOS_SHELL_PLATFORM:+"$KOSMOS_SHELL_PLATFORM"}
  elif [ "$_RT_SHELL_PARALLEL" != 1 ]; then
    # #7100: the n shards at once. Each writes its own log, in a folder beside the run root (inside it, the leak guard
    # would read the logs as a new temp family), and the logs are printed in shard order once all have ended. The part
    # is red when any shard is red. On an interruption the EXIT traps above stop each shard as a whole process group
    # (TERM, then KILL after about 2 s, its running test included, before the run root goes; not a process that left
    # the group), print the end of each shard's log, and remove the folder. A SIGKILL to this script (or to its process
    # group) runs no trap; each shard still running then sees its runner gone and stops its own group (test 4f).
    _rt_ps_dir="$(mktemp -d "$(dirname "$KOSMOS_RUN_TMPDIR")/kt-shellpar.XXXXXXXXXX")" || _rt_ps_dir=""
    if [ -z "$_rt_ps_dir" ]; then
      echo "run-tests: could not make a folder for the parallel shell shards' logs; refusing rather than run them unlogged (#7100)" >&2
      (exit 2)   # the status NODE_STATUS=$? reads below the fi
    else
      # tools/lib/shell-parallel.sh was loaded where the switch is read, above.
      # No cut-shape wrapper here: KOSMOS_SHELL_CUT_ENV=1 is refused with this switch, and its wrapper is a shell
      # function that a shard started through exec could not run.
      kosmos_shell_parallel "$_RT_SHELL_PARALLEL" "$_rt_ps_dir" node "$REPO/tools/shell-shard.js" run
      _rt_ps_rc=$?
      rm -rf "$_rt_ps_dir"; _rt_ps_dir=""
      (exit "$_rt_ps_rc")   # the status NODE_STATUS=$? reads below the fi
    fi
  else
    # #5907: the whole of test:shell as shard 1 of 1 (the same commands in the same order, stopping at the first
    # red, as the && chain did), so the log names each command's time and the slowest ones.
    ${_rt_shell_wrap[@]+"${_rt_shell_wrap[@]}"} node "$REPO/tools/shell-shard.js" run 1 1
  fi
  NODE_STATUS=$?
fi
# --- #3011: refuse if the suite created or modified a real com.kosmos.agent.* plist -
# The whole-suite guard for the leak class (a test missing its AGENT_WORKFORCE_LAUNCH
# sandbox). Runs regardless of the test verdict, so a leak is reported even beside a red.
if [ -n "$_la_guard_before" ]; then
  # #5092: plists the machine's LIVE Kosmos rewrote for its own agents during the run are skipped, and said.
  # No notes file means no skip (live root "/"), so a skip is never silent (review 1).
  _la_live_root=""
  _la_live_notes="$(mktemp "${TMPDIR:-/tmp}/la-live-notes.XXXXXXXXXX")" || { _la_live_notes=""; _la_live_root="/"; }
  if ! _la_leaked="$(launchagent_leak_check "$_la_guard_dir" "$_la_guard_before" "$_la_live_notes" "$_la_live_root" 2>&1)"; then
    # #3605: print each leaked plist WITH the sandbox it points into. The check sees the
    # shared folder, not this run, so a concurrent suite from another checkout lands here
    # too; the working dir (usually the writer's test sandbox) is how you tell.
    printf '%s\n' "$_la_leaked" | while IFS= read -r _la_f; do
      [ -n "$_la_f" ] || continue
      echo "  $_la_f  (working dir: $(launchagent_leak_origin "$_la_f"))" >&2
    done
    echo "run-tests: #3011 LEAK -- a real com.kosmos.agent.* plist was created or modified in ~/Library/LaunchAgents while this suite ran (listed above). Move them out (launchctl bootout gui/\$(id -u)/<label> first if loaded). Either a test here is missing 'process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, \"LaunchAgents\")', or ANOTHER checkout that predates #3011/#3605 ran its suite at the same time: this tree's create.js refuses such writes under node --test, so if no test here failed on a #3605 refusal, look for an older worktree. Rerun alone to confirm." >&2
    [ "$NODE_STATUS" -eq 0 ] && NODE_STATUS=1
  fi
  launchagent_live_notes_report "$_la_live_notes"
  rm -f "$_la_guard_before" "$_la_live_notes"
fi
# --- #4273: refuse a launchd job, a process or a new temp family the suite left --
# Runs regardless of the verdict, like #3011, so a leak is reported beside a red. A
# leaked job is booted out and a leaked process stopped, so the machine is clean
# either way; the run still fails so the test that leaked gets fixed. The temp check
# compares FAMILIES (lib/test-leak-guard.sh leak_family) with
# tools/test-leak-allowlist.txt: families that already leak are listed until fixed,
# and a NEW one fails. The whole per-run root is removed at exit regardless.
if [ "${TMPDIR:-}" = "$KOSMOS_RUN_TMPDIR" ]; then
  if ! _tl_out="$(leak_guard_after_suite "$_tl_labels_before" "$KOSMOS_RUN_TMPDIR" "$REPO/tools/test-leak-allowlist.txt")"; then
    printf '%s\n' "$_tl_out" | sed 's/^/  /' >&2
    echo "run-tests: #4273 LEAK -- the suite left the things listed above behind (launchd jobs are booted out and processes stopped already). Make the test that made them clean up: require('./test-support/tmpscope') at the top of a test file contains its temp dirs, a launchd job needs a bootout in its cleanup even on failure, and a spawned process needs a kill. A family that is known to leak and not yet fixed can be added to tools/test-leak-allowlist.txt." >&2
    [ "$NODE_STATUS" -eq 0 ] && NODE_STATUS=1
  elif [ -n "$_tl_out" ]; then
    printf '%s\n' "$_tl_out" | sed 's/^/  /' >&2
  fi
  [ -n "$_tl_labels_before" ] && rm -f "$_tl_labels_before"
fi
# --- #1720: the repo-local browser-check gate ---------------------------------
# A committed web/ change must carry a docs/browser-checks/ assertion update, or an
# explicit `Browser-check: <reason>` override trailer, else this branch is refused
# here -- before an unasserted rendered surface can merge and reach a release, the
# gap that killed a cut. Run in a subshell so the lib's IFS/globals do not leak.
# The lib is fail-soft (returns 0 when it cannot diff), so this only ever reds a
# real branch gap: on main / a detached HEAD / a fresh clone origin/main...HEAD is
# empty or unreadable and the gate passes.
# (#4929: not for --only, which runs named files and says nothing about the branch.)
if [ "$NODE_STATUS" -eq 0 ] && [ "$KOSMOS_ONLY" != 1 ]; then
  ( . "$REPO/tools/lib/browser-check-gate.sh" && kosmos_browser_check_gate )
  NODE_STATUS=$?
fi
# #2518: the SURFACE-SPECIFIC companion -- refuses a web/index.html change that touches
# a token a browser-check asserts (its `// Browser-check-surface:` annotation) without
# updating that check, catching the specific staleness the coarse gate above lets through.
# Same subshell isolation + fail-soft contract.
if [ "$NODE_STATUS" -eq 0 ] && [ "$KOSMOS_ONLY" != 1 ]; then
  ( . "$REPO/tools/lib/browser-check-surface-gate.sh" && kosmos_browser_check_surface_gate )
  NODE_STATUS=$?
fi

# --- name the machine, only beside a red -------------------------------------
if [ "$NODE_STATUS" -eq 126 ] || [ "$NODE_STATUS" -eq 127 ]; then
  echo
  echo "=== exit $NODE_STATUS is not a failing test ==="
  echo "Something the suite needs could not be run (missing or not executable: node itself, or a program a shell test calls). Read the failing command's own output (in a shell-part red, between its start and time lines, above the shell-shard summary); no assertion failed."
fi
if [ "$NODE_STATUS" -ne 0 ]; then
  echo
  echo "=== the machine, when this run started (#708) ==="
  if [ -n "$BEFORE" ]; then
    echo "This run shared the Mac with:"
    printf '%s\n' "$BEFORE" | sed 's/^/  /'
    echo "A red that is green alone is contention, not the change; rerun the failing file alone before calling it a defect."
    echo "A test that dies on 'we could not see what is running' or a timeout met a busy machine, not a missing thing (#704)."
  else
    echo "Nothing else was on the default port and no page gate was running, so this red is not contention with a board; read it."
  fi
  # #6668: the limits this run's node part had (scaled by the time-scale above), under their own label, so a red
  # beside a TIMED OUT line or a cancelled test reads against the limit it met. Only when the NODE part itself was red: a
  # green node part (a shell-part or gate red, or a shell-only run) prints no limit line. A watchdog that could not
  # start enforced nothing, and says so.
  if [ "${_rt_node_status:-0}" -ne 0 ]; then
    if [ "${_rt_wd_started:-0}" != 1 ]; then _rt_wd_said="per-file limit: off (the watchdog could not start)"
    elif [ "${_rt_wd_found:-0}" != 1 ]; then _rt_wd_said="per-file limit: off (node --test not found before the run ended)"
    else _rt_wd_said="per-file limit $RT_FILE_TIMEOUT_LABEL"; fi
    echo "Limits this run: $_rt_wd_said, per-test limit ${RT_TEST_TIMEOUT_MS} ms (#6668)"
  fi
fi
exit "$NODE_STATUS"
