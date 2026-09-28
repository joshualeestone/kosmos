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
# rerun alone or read the red. Green runs print nothing extra.
#
# The suite itself is isolated by construction (every booted server takes
# port 0, every store-using test sandboxes before requiring, every shell test
# stubs launchctl), so this names contention; it does not paper over a test
# that reaches shared state. Such a test is a bug, and its red still shows.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# #4317: CI runs the two halves as separate parallel jobs. KOSMOS_TEST_PART picks one:
#   all   (the default, and what `yarn test` runs): the node suite, then test:shell, as before;
#   node  the node suite only;
#   shell test:shell only, or with KOSMOS_SHELL_SHARD=i/n just shard i of n (tools/shell-shard.js).
# Every part keeps every guard below (coverage, launchd, temp root, leaks, the browser-check gates).
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

# #2858: strip the ambient Codex-home vars ONCE here, at the single runner every
# `yarn test` (and the canonical validation / pre-challenge gate) routes through,
# so the whole suite -- node AND `yarn test:shell`, every test including ones not
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

# #4253: no board a test boots may phone home. A sandboxed board mints a fresh install id,
# so each boot sent installkosmos.com a new install (count 0, darwin) and inflated the
# public install count by thousands a day. The beacon itself is untouched (Josh's 09-14
# ruling: the real install ping is never removed or made opt-out-able); only this
# harness points it, and the daily report, at a dead local port.
export AGENT_WORKFORCE_CREATED_URL=http://127.0.0.1:9/api/created
export AGENT_WORKFORCE_FEEDBACK_URL=http://127.0.0.1:9/api/feedback
export AGENT_WORKFORCE_COMMUNITY_URL=http://127.0.0.1:9/

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
  cores="$(sysctl -n hw.ncpu 2>/dev/null)"
  [ -n "$load" ] && lines+=("1-minute load $load on ${cores:-?} cores")
  printf '%s
' "${lines[@]}"
}
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
if command -v kosmos_refuse_if_machine_claimed >/dev/null 2>&1; then
  kosmos_refuse_if_machine_claimed "this test run" || exit 1
fi
# #4410: nor beside a live install harness (tools/test-install.sh). It boots real boards on test
# ports and checks that they let go of them; a suite started 3 minutes into one, both behind a
# clear heavy-gate, reddened its port checks (Kano, 2026-09-28). Fail-open on the library load,
# as above. A harness only a unit test started (the #4259 fixture rule) does not count.
# test-install.sh asks the mirror question (kosmos_refuse_if_suite_live) before it starts.
if command -v kosmos_refuse_if_harness_live >/dev/null 2>&1 && [ "${KOSMOS_TESTS_IGNORE_HARNESS:-0}" != 1 ]; then
  kosmos_refuse_if_harness_live "this test run" "KOSMOS_TESTS_IGNORE_HARNESS=1 runs anyway" || exit 1
fi

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
# for the run that made it.
#
# ⚠️ WHAT THIS DOES NOT COVER, MEASURED, BECAUSE THE OBVIOUS ASSUMPTION IS
# WRONG: macOS `mktemp` IGNORES TMPDIR. It reads the per-user directory from
# `confstr(_CS_DARWIN_USER_TEMP_DIR)` instead, so a shell test calling
# `mktemp -d` lands in the real temp root no matter what this exports. Verified
# by setting TMPDIR to two different values and getting /var/folders back both
# times. Node's `os.tmpdir()` DOES honour it, which is why this catches 91 of
# the 92. The four that remain are three `tmp.*` from shell tests and one yarn
# scratch dir. Those need their own cleanup at their own call sites; do not
# assume this line covers them.
KOSMOS_RUN_TMPDIR="${TMPDIR:-/tmp}"
KOSMOS_RUN_TMPDIR="${KOSMOS_RUN_TMPDIR%/}/kt$$"
if mkdir -p "$KOSMOS_RUN_TMPDIR" 2>/dev/null; then
  # kosmos#4273: an INTERRUPTED run (Ctrl-C, a runner's timeout) never reaches the leak
  # guard, and removing the root under a launchd job loaded from a plist in it is the
  # 8,096-respawn shape. So while the labels snapshot is still unused (the guard removes
  # it), the trap boots out this run's jobs before the root goes.
  trap '[ -n "${_tl_labels_before:-}" ] && [ -f "$_tl_labels_before" ] && type leak_launchd_check >/dev/null 2>&1 && leak_launchd_check "$_tl_labels_before" "$KOSMOS_RUN_TMPDIR" >&2; rm -rf "$KOSMOS_RUN_TMPDIR"' EXIT
  export TMPDIR="$KOSMOS_RUN_TMPDIR"
else
  # Never fail a run over housekeeping: the suite is what matters.
  echo "run-tests: could not make a per-run temp dir; the suite will use TMPDIR directly and leave its scratch behind" >&2
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

# --- #3011: snapshot the real ~/Library/LaunchAgents before the suite runs ----
# A test that creates agents without sandboxing AGENT_WORKFORCE_LAUNCH leaks a real
# com.kosmos.agent.* plist into launchd (phantom agents on the board). Snapshot the
# real set now; the leak check after the suite refuses any created or modified during
# it. Fail-soft: a snapshot failure leaves an empty baseline, never a false red here.
. "$(dirname "$0")/lib/launchagent-leak-guard.sh"
# $HOME here, while the #3605 guards use the account home: they agree unless HOME is redirected.
_la_guard_dir="${HOME}/Library/LaunchAgents"
_la_guard_before="$(mktemp "${TMPDIR:-/tmp}/la-leak-before.XXXXXXXXXX")" || _la_guard_before=""
[ -n "$_la_guard_before" ] && launchagent_snapshot "$_la_guard_dir" > "$_la_guard_before"

# --- #4273: what the suite leaves behind: launchd jobs, processes, temp entries -
# Snapshot the loaded launchd labels now; after the suite, lib/test-leak-guard.sh
# checks all three, each scoped to THIS run's temp root so a suite running beside
# another never blames or kills the other's. Only when the per-run root exists.
. "$(dirname "$0")/lib/test-leak-guard.sh"
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
NODE_STATUS=0
if [ "$KOSMOS_TEST_PART" != shell ]; then
node --test --require "$REPO/test-support/launch-guard.js" --require "$REPO/test-support/tool-guard.js" "${KOSMOS_TEST_FILES[@]}" "$@"
NODE_STATUS=$?
fi
if [ "$NODE_STATUS" -eq 0 ] && [ "$KOSMOS_TEST_PART" != node ]; then
  if [ -n "${KOSMOS_SHELL_SHARD:-}" ]; then
    node "$REPO/tools/shell-shard.js" run "${KOSMOS_SHELL_SHARD%/*}" "${KOSMOS_SHELL_SHARD#*/}"
  else
    yarn -s test:shell
  fi
  NODE_STATUS=$?
fi
# --- #3011: refuse if the suite created or modified a real com.kosmos.agent.* plist -
# The whole-suite guard for the leak class (a test missing its AGENT_WORKFORCE_LAUNCH
# sandbox). Runs regardless of the test verdict, so a leak is reported even beside a red.
if [ -n "$_la_guard_before" ]; then
  if ! _la_leaked="$(launchagent_leak_check "$_la_guard_dir" "$_la_guard_before" 2>&1)"; then
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
  rm -f "$_la_guard_before"
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
if [ "$NODE_STATUS" -eq 0 ]; then
  ( . "$(dirname "$0")/lib/browser-check-gate.sh" && kosmos_browser_check_gate )
  NODE_STATUS=$?
fi
# #2518: the SURFACE-SPECIFIC companion -- refuses a web/index.html change that touches
# a token a browser-check asserts (its `// Browser-check-surface:` annotation) without
# updating that check, catching the specific staleness the coarse gate above lets through.
# Same subshell isolation + fail-soft contract.
if [ "$NODE_STATUS" -eq 0 ]; then
  ( . "$(dirname "$0")/lib/browser-check-surface-gate.sh" && kosmos_browser_check_surface_gate )
  NODE_STATUS=$?
fi

# --- name the machine, only beside a red -------------------------------------
if [ "$NODE_STATUS" -eq 126 ] || [ "$NODE_STATUS" -eq 127 ]; then
  echo
  echo "=== exit $NODE_STATUS is not a failing test ==="
  echo "Something the suite needs could not be run (missing or not executable: node itself, yarn, or a program a shell test calls). Read the last line before the exit; no assertion failed."
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
fi
exit "$NODE_STATUS"
