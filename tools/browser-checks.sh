#!/usr/bin/env bash
#
# The page-layer gate (#39).
#
# 🛑 DO NOT RUN THIS, OR ANY BROWSER CHECK, WHILE A RELEASE CUT IS RUNNING.
# Measured 2026-08-26, and it cost a cut. Four concurrent Playwright boards
# during a cut's page layer starved it of CPU, and render-github-door failed
# six arms with three HARD errors -- `settingsGo is not defined`, `null.click`,
# a control stuck on "Checking..." -- every one of which reads like missing
# code. On the SAME SHA with nothing else running, that check passes and so do
# the other 36: 869 assertions, zero failures.
# ⭐ The symptom is indistinguishable from a real defect, which is why this is a
# rule and not a preference: three people had a confident, coherent, WRONG
# explanation available before anyone re-ran it alone.
# 📌 Counting `Chromium` processes is NOT how you tell whether the field is
# clear. This spawns one per check and exits it, so a point sample reads zero
# at a trough and dozens at a peak, and misleads in both directions. Count the
# `browser-checks.sh` PARENTS instead.
#
# `node --test` reads source; it cannot see the page. The scripts under
# docs/browser-checks/ can, but they lived outside every automated run, so a
# page-layer regression reached main uncaught: round 16 of the project-chat
# review ran 18 page mutations and 16 survived the whole suite. This harness
# runs the load-bearing ones headless, on a sandboxed fixture server per check,
# so the release gate covers the page the way the suite covers the engine.
#
# 🔑 THE BROWSER LIVES IN THE JOB, NEVER IN package.json. A clean clone still
# runs with zero dependencies and `yarn test` still needs no browser: the
# README's promise stays literally true. This harness borrows Playwright from a
# NODE_PATH the machine already has (the exact pattern the checks document), and
# fails loud rather than silently skipping if it cannot find one.
#
#   Playwright is resolved from, in order:
#     $KOSMOS_PW_NODE_PATH           (a node_modules dir containing playwright)
#     ~/work/pw-runtime/node_modules
#     ~/.npm/_npx/*/node_modules     (an npx cache, where `npx playwright` lands)
#   To provision one:  PW=$(mktemp -d); cd "$PW" && npm i playwright \
#                        && npx playwright install chromium
#   then export KOSMOS_PW_NODE_PATH="$PW/node_modules".
#
# ⚠️ HEADLESS on purpose. A CI or release machine has no console, and every
# check the MVP runs asserts COMPUTED STATE (aria-checked, which container is
# hidden, derived text), which software rendering reproduces faithfully. Paint
# and geometry are weaker headless; a check that leans on them belongs in a
# headed run, not this gate, and the MVP set is chosen accordingly.
#
# Exit status: 0 iff every selected check passed (after at most one retry).
#
set -uo pipefail

log()  { printf '%s\n' "$*"; }
sec()  { printf '\n=== %s ===\n' "$*"; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# 🛑 REFUSE A SECOND CONCURRENT PAGE LAYER. The header above blames "a release
# cut", but re-read what it measured: FOUR CONCURRENT PLAYWRIGHT BOARDS starved
# the run of CPU. The cut was how a second run came to exist, not the thing that
# broke it. Measured 2026-08-27 13:17Z: a hand-run `bash tools/browser-checks.sh`
# had been live 8m29s, there was NO cut, `pgrep release.sh` correctly returned
# nothing, and the cut guard said clear -- so nothing on this Mac would have
# stopped a second run from starting. This asks about the thing that breaks.
# The escape hatch is the one the cut guard already uses, deliberately: an
# operator who has decided to override does not want to learn a second name.
# ✅ RE-ARMED 2026-08-29 (#1391), AFTER REPRODUCING THE FALSE POSITIVE THE
# DISARM NOTE ASKED FOR. It had refused Baron's 0.5.80 at step 3b reporting
# "1 live" while nothing else ran. The named cause ("$$ does not change in a
# subshell") was true and NOT the cause. The real cause, reproduced
# deterministically: macOS `pgrep -f` never lists its own ANCESTOR, so the
# caller was invisible to its own pid exclusion; and this script forks bash
# subshells that inherit its command line with fresh pids, which pgrep DOES
# list and a single-pid exclusion could not drop -- so the gate matched its own
# page-layer subtree and refused itself. The fix (tools/lib/cut-guard.sh)
# excludes the caller's whole SUBTREE, not one pid; the guard's tests cover both
# a descendant (stays green) and an out-of-subtree run (refuses). The escape
# hatch is the one the cut guard already uses, deliberately: an operator who has
# decided to override does not want to learn a second name.
. "$REPO/tools/lib/cut-guard.sh"
if [ "${KOSMOS_HARNESS_IGNORE_CUT:-0}" != 1 ]; then
  kosmos_refuse_if_browser_run_live "this page layer" || exit 1
fi

# --- freeze against a concurrent merge (#758) --------------------------------
# Every check below reads CODE straight from $REPO (boot_board only sandboxes
# DATA dirs), so a merge landing in a shared, mutable checkout WHILE this runs
# can flip a booted board's self-reported freshness underneath every check
# that shares it -- this is what broke render-reload-toast (kosmos#813).
#
# A real release cut already avoids this: tools/release.sh freezes a detached
# worktree at the bump sha and reassigns REPO to it (tools/lib/release-freeze.sh,
# #597/#611) BEFORE invoking this script (`REPO="$BUILD"`, then `cd "$REPO" &&
# bash tools/browser-checks.sh`) -- so a DETACHED HEAD here is the signature of
# already being isolated. Freezing again would cost a second worktree on the
# one path that is already time-pressured (a 25-minute cut), for no isolation
# gained. A normal branch checkout -- a direct `bash tools/browser-checks.sh`,
# the path that bit Mona Lisa -- is the vulnerable case, and gets frozen here.
SOURCE_REPO="$REPO"
FREEZE_BUILD=""
FREEZE_ROOT=""
if git -C "$REPO" symbolic-ref -q HEAD >/dev/null 2>&1; then
  # Loud, not silent, about the one real behaviour change: before this, a
  # direct run always saw uncommitted edits; a frozen worktree is checked out
  # from the last COMMIT, so it will not.
  if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
    log "‼️  $REPO has uncommitted changes. This run freezes a detached copy of the LAST COMMIT (#758) -- uncommitted edits will not be reflected. Commit first to check them."
  fi
  # shellcheck source=lib/release-freeze.sh
  . "$REPO/tools/lib/release-freeze.sh"
  FREEZE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-bc-freeze.XXXXXX")" || { log "no temp dir for the frozen tree"; exit 1; }
  FREEZE_BUILD="$(release_freeze "$REPO" "$(git -C "$REPO" rev-parse HEAD)" "$FREEZE_ROOT")" || { rm -rf "$FREEZE_ROOT"; log "could not freeze the tree (#758)"; exit 1; }
  REPO="$FREEZE_BUILD"
  cd "$REPO"
  log "Frozen at $(git -C "$REPO" rev-parse --short HEAD) ($REPO) -- a concurrent merge into $SOURCE_REPO cannot move this run."
else
  # ⚠️ KNOWN LIMITATION, narrow: detached HEAD is release.sh's freeze in
  # practice (its only automated caller), but is not UNIQUE to it -- a
  # developer mid-rebase, mid-bisect, or who manually checked out a sha in
  # an ordinary worktree also detaches, and would silently skip both the
  # freeze AND the uncommitted-changes warning above. Accepted for now: the
  # false-negative only fires on a deliberately unusual local git state, not
  # on the normal "commit, then run" workflow this fix targets.
  log "Already on a detached HEAD ($REPO) -- isolated by the caller (release.sh's own freeze, #597/#611); not freezing again."
fi

# --- cleanup, registered THE MOMENT there is anything to clean up -----------
# ⚠️ MUST be set up before any code that can exit early (the Playwright
# resolution block right below does, at KOSMOS_SKIP_BROWSER_CHECKS=1 and at
# "no Playwright found"). A first version of the #758 freeze registered this
# trap later, alongside RUN_DIR -- so a machine with no Playwright (a normal
# CI/release-machine case this same file's own header names) froze a
# worktree, then exited before the trap that would have thawed it existed,
# leaking a phantom `.git/worktrees` entry and a temp dir on every such run.
# ⚠️ ONE RUN DIRECTORY, REMOVED WHOLE. The first version kept an array of
# sandboxes and removed each on exit, and it never removed one: new_sandbox
# is called as `sb="$(new_sandbox)"`, a subshell, so the append to the array
# happened in a copy and cleanup saw an empty list. 200 leaked sandboxes,
# 131 MB, in TMPDIR by 2026-08-24 18:20, and a "gates running" signal in
# tools/run-tests.sh that counted them as 200 live gates (#708). Every sandbox
# now lives under one per-run directory, and cleanup removes that directory.
# Servers were never affected: boot_board appends to SERVER_PIDS directly.
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-bc.XXXXXX")"
SERVER_PIDS=()
cleanup() {
  local pid
  for pid in "${SERVER_PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null; done
  rm -rf "$RUN_DIR"
  # #758: thaw the frozen worktree, if this run made one. release_thaw is
  # defined only when FREEZE_BUILD was set (the freeze block sourced
  # release-freeze.sh), so the guard also protects against calling an
  # undefined function on the already-detached (no freeze needed) path.
  if [ -n "$FREEZE_BUILD" ]; then
    release_thaw "$SOURCE_REPO" "$FREEZE_BUILD"
    rm -rf "$FREEZE_ROOT"
  fi
}
trap cleanup EXIT

FAKE_TMUX="$REPO/test-support/fake-tmux.sh"
FAILED=()
RAN=()
RETRIED=()

# --- Playwright, borrowed not depended-on -----------------------------------
resolve_pw() {
  if [ -n "${KOSMOS_PW_NODE_PATH:-}" ]; then
    [ -d "$KOSMOS_PW_NODE_PATH/playwright" ] && { printf '%s' "$KOSMOS_PW_NODE_PATH"; return 0; }
    log "KOSMOS_PW_NODE_PATH=$KOSMOS_PW_NODE_PATH has no playwright in it." >&2
    return 1
  fi
  local c
  for c in "$HOME/work/pw-runtime/node_modules" "$HOME"/.npm/_npx/*/node_modules; do
    [ -d "$c/playwright" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

PW_NODE_PATH="$(resolve_pw || true)"
if [ -z "$PW_NODE_PATH" ]; then
  # 🛑 LOUD, NEVER SILENT. A page gate that cannot find a browser and passes
  # anyway is the exact "a check that cannot report its own weakness is not
  # reporting" failure. Block by default; an operator who means to skip must
  # say so, and even then it is said out loud.
  if [ "${KOSMOS_SKIP_BROWSER_CHECKS:-0}" = "1" ]; then
    log "‼️  BROWSER CHECKS SKIPPED: no Playwright found and KOSMOS_SKIP_BROWSER_CHECKS=1."
    log "‼️  The page layer is NOT covered by this run. This is a deliberate opt-out, printed so it is never mistaken for a pass."
    exit 0
  fi
  log "🛑 No Playwright found, so the page layer cannot be checked."
  log "   Provision one and re-run:"
  log "     PW=\$(mktemp -d); (cd \"\$PW\" && npm i playwright && npx playwright install chromium)"
  log "     KOSMOS_PW_NODE_PATH=\"\$PW/node_modules\" $0"
  log "   Or, to run the rest of the release without page coverage (said out loud): KOSMOS_SKIP_BROWSER_CHECKS=1"
  exit 2
fi
log "Playwright: $PW_NODE_PATH"

new_sandbox() {
  local sb; sb="$(mktemp -d "$RUN_DIR/sb.XXXXXX")"
  printf '%s' "$sb"
}

# Write a list-panes fixture so the board reports a fixture fleet (april,
# mikey), which the project and composition checks need on screen.
write_fleet() {
  local sb="$1"
  node -e "const f=require('./test-support/fleet');process.stdout.write([f.line({session:'april-discord'}),f.line({session:'mikey-discord'})].join('\n')+'\n')" \
    > "$sb/panes.txt"
}

# Every fixture server below is started as `node ./server.js`, never
# `node server.js`. `pkill -f "node server.js"` is a substring match on the
# command line, and agents on the build Mac run it to restart the board; at
# 11:42 on 2026-08-25 one such sweep took seven fixture servers with it and
# killed cut 0.5.28's page checks (11 checks refused, one cut lost). The
# board itself survived because launchd starts it by absolute path, so the
# string never occurs in its argv. `./` is the same protection here. It does
# not protect against `pkill -f node` or `pkill -f server.js`; nothing can.
# (Shredder's diagnosis; server.js reads no argv and resolves every path from
# __dirname, so the form of the invocation changes nothing it does.)
# Boot ./server.js sandboxed on $port with the fixture fleet. Echoes nothing;
# records the pid. Waits until /api/status answers.
# ⭐ THE FIXTURE FOUR CHECKS WERE BLOCKED ON (#1072). write_fleet seeds TWO
# running agents and nothing else, which is all most checks need. Four of the
# ten unwired checks are unwired for want of a richer board, and NONE of them
# was a product defect -- they were never run because the shared boards cannot
# show them their subject:
#   render-org-chart    wants FOUR or more agents (measured: it fails at 3)
#   render-not-running  wants an agent that EXISTS and is NOT running
#   render-survival     wants the same
#   render-list-row     wants BOTH, so it can compare the two row kinds
# An agent that exists and is not running is a PROFILE with no pane. That is
# the whole trick, and it is why a roster-only fixture cannot produce one.
write_fleet_rich() {
  local sb="$1"
  # 🛑 THREE RUNNING, AND THE COUNT IS LOAD-BEARING. With the two not-running
  # agents below this board holds FIVE agents, and render-org-chart asserts the
  # drawing fills more than a third of its canvas — which is a function of how
  # many nodes there are. MEASURED across sizes against this exact check:
  #     3 agents  fail        4 agents  59%  pass
  #     5 agents  59%  pass   6 agents  53%  FAIL
  # So it passes in a BAND, not above a floor. Adding an agent here to make
  # some future check happy will take org-chart red, and it will look like a
  # layout regression rather than a fixture change.
  node -e "const f=require('./test-support/fleet');process.stdout.write(['april','mikey','donnie'].map((n)=>f.line({session:n+'-discord'})).join('\n')+'\n')" \
    > "$sb/panes.txt"
  # The not-running ones: a profile and a worker dir, and deliberately NO pane.
  # ⚠️ TWO OF THEM, AND THE NAMES ARE NOT INTERCHANGEABLE. render-not-running
  # matches /ghosty/ and render-survival matches /brigitte/, each hardcoded in
  # the check. Seeding only one made render-survival fail IN THE RUNNER after
  # passing on a board booted by hand — the exact fresh-board-versus-in-sequence
  # gap this whole card is about, reproduced in the fix for it.
  mkdir -p "$sb/data/AgentWorkforce/profiles" "$sb/workers/ghosty" "$sb/workers/brigitte"
  printf '%s\n' '{"role":"Copywriter","displayName":"Ghosty"}' \
    > "$sb/data/AgentWorkforce/profiles/ghosty.json"
  printf '%s\n' '{"role":"helper"}' \
    > "$sb/data/AgentWorkforce/profiles/brigitte.json"
}
# 🛑 THE BOARD SCANS THE OPERATOR'S REAL $HOME UNLESS THIS IS SET.
# `status.configRoots()` (engine/status.js:56) returns [CONFIG_ROOT] when the
# variable is set and otherwise walks $HOME for `.claude*`. This harness set it
# NOWHERE, so every board booted here has been reading whatever agents happen to
# live on the machine running the checks.
# ⭐ IT IS A FALSE-GREEN MACHINE, NOT JUST NOISE: the first-run create ending
# calls frFindAgents() and paints the FOUND screen instead whenever that scan
# returns anything, so a check asserting the create ending passes or fails on
# how many agents the operator happens to have. Mine passed on my own sandboxed
# board and failed in the suite for exactly this reason, and the difference was
# invisible in both transcripts.
# 📌 Same defect as #1134, which fixed only docs/browser-checks/thread-server.js.
# The default is per-sandbox so each board is isolated; a caller may override.
boot_board_rich() {
  local sb="$1" port="$2"
  write_fleet_rich "$sb"
  AGENT_WORKFORCE_DATA="$sb/data" AGENT_WORKFORCE_WORKERS="$sb/workers" \
    AGENT_WORKFORCE_LAUNCH="$sb/launch" AGENT_WORKFORCE_PROJECTS="$sb/projects" \
    AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb/panes.txt" \
    AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 \
    AGENT_WORKFORCE_CONFIG_ROOT="${AGENT_WORKFORCE_CONFIG_ROOT:-$sb/config}" \
    PORT="$port" node ./server.js > "$sb/server.log" 2>&1 &
  SERVER_PIDS+=("$!")
  wait_up "$port" "$sb/server.log"
}
boot_board() {
  local sb="$1" port="$2"
  write_fleet "$sb"
  AGENT_WORKFORCE_DATA="$sb/data" AGENT_WORKFORCE_WORKERS="$sb/workers" \
    AGENT_WORKFORCE_LAUNCH="$sb/launch" AGENT_WORKFORCE_PROJECTS="$sb/projects" \
    AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb/panes.txt" \
    AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 \
    AGENT_WORKFORCE_CONFIG_ROOT="${AGENT_WORKFORCE_CONFIG_ROOT:-$sb/config}" \
    PORT="$port" node ./server.js > "$sb/server.log" 2>&1 &
  SERVER_PIDS+=("$!")
  wait_up "$port" "$sb/server.log"
}

# Boot the thread fixture server (self-sandboxing, its own fleet).
boot_thread_server() {
  local sb="$1" port="$2"
  AGENT_WORKFORCE_DATA="$sb/data" AGENT_WORKFORCE_WORKERS="$sb/workers" \
    AGENT_WORKFORCE_LAUNCH="$sb/launch" AGENT_WORKFORCE_PROJECTS="$sb/projects" \
    PORT="$port" node docs/browser-checks/thread-server.js > "$sb/server.log" 2>&1 &
  SERVER_PIDS+=("$!")
  wait_up "$port" "$sb/server.log"
}

wait_up() {
  local port="$1" logf="$2" i
  for i in $(seq 1 60); do
    curl -s "http://127.0.0.1:$port/api/status" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  log "server on :$port never answered; log tail:"; tail -5 "$logf" 2>/dev/null
  return 1
}

# run_one <label> <cmd...>: run a check headless, retry ONCE on failure, and say
# out loud when it retried. A green that quietly retried is indistinguishable
# from a clean green, so the retry is always printed.
# A red must say WHY in the summary, or it gets re-run instead of read (#616:
# the gate now asks 28 checks, and a label alone is a coin to flip). Each
# attempt's output is captured as well as streamed, and on the final failure
# the check's own FAIL and error lines are kept and printed under its label.
REASONS=()
run_one() {
  local label="$1"; shift
  local cap; cap="$(mktemp "${TMPDIR:-/tmp}/kosmos-bc-out.XXXXXX")"
  RAN+=("$label")
  sec "$label"
  HEADED=0 NODE_PATH="$PW_NODE_PATH" "$@" 2>&1 | tee "$cap"; local rc="${PIPESTATUS[0]}"
  if [ "$rc" -eq 0 ]; then
    log "PASS  $label"; rm -f "$cap"
    return 0
  fi
  # ⚠️ 126 AND 127 ARE NOT ASSERTIONS. They mean the thing could not be run
  # at all (a binary missing, like `timeout` on macOS, or not executable),
  # and they were read as four failed checks on 2026-08-24 by the person who
  # wrote this line. A gate must still refuse on them, and it must not retry
  # them (the binary will not appear), and it must say what they are.
  if [ "$rc" -eq 126 ] || [ "$rc" -eq 127 ]; then
    log "COULD NOT RUN  $label (exit $rc: a program it needs is missing or not executable; this is not an assertion failing)"
    FAILED+=("$label")
    REASONS+=("$label:"$'\n'"           exit $rc: could not run, a program it needs is missing or not executable. Read the line above the exit, not the assertions.")
    rm -f "$cap"
    return 1
  fi
  log "⚠️  $label failed once, retrying (flaky-timeout guard). A retried pass is reported, not hidden."
  RETRIED+=("$label")
  if HEADED=0 NODE_PATH="$PW_NODE_PATH" "$@" 2>&1 | tee "$cap"; [ "${PIPESTATUS[0]}" -eq 0 ]; then
    log "PASS  $label (on retry — treat repeated retries as a finding, not noise)"; rm -f "$cap"
    return 0
  fi
  log "FAIL  $label (failed twice)"
  FAILED+=("$label")
  local why; why="$(grep -E '^\s*(FAIL|✖)|Error|Timeout|REFUS|refus' "$cap" | grep -vE '^\s*at ' | head -3 | cut -c1-200 | sed 's/^/           /')"
  REASONS+=("$label:"$'\n'"${why:-           (no FAIL or error line in its output; read the full log)}")
  rm -f "$cap"
  return 1
}

# free-ish ports, distinct per check
# Ports come from the OS, one per boot, chosen at the moment this run starts
# (#633). They used to be fixed (17341 to 17347), and two runs of this script
# on one Mac, the release gate and a person's own check, talked to each
# other's boards and then lost them when the other run ended: a red that read
# as a flaky check and was a collision. A port the kernel just handed out is
# free for this run alone; the window between picking and binding is a few
# milliseconds and two runs started seconds apart never share one. The
# chosen ports are printed so a log can be read back against a boot.
free_port() {
  node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})'
}
pick_ports() {
  local picked=() p n
  while [ "${#picked[@]}" -lt 13 ]; do
    p="$(free_port)"
    for n in ${picked[@]+"${picked[@]}"}; do [ "$n" = "$p" ] && p=""; done
    [ -n "$p" ] && picked+=("$p")
  done
  P1="${picked[0]}"; P2="${picked[1]}"; P3="${picked[2]}"; P4="${picked[3]}"; P5="${picked[4]}"; P6="${picked[5]}"; P7="${picked[6]}"; P8="${picked[7]}"; P9="${picked[8]}"; P10="${picked[9]}"; P11="${picked[10]}"; P12="${picked[11]}"; P13="${picked[12]}"
}
pick_ports
log "ports for this run: $P1 $P2 $P3 $P4 $P5 $P6 $P7 $P8 $P9 $P10 $P11 $P12 (chosen by the OS, #633)"

# --- 1. regress-a-night: a night's releases still COMPOSE --------------------
# The one check that asserts the whole board still hangs together (three
# layouts, the switches, accounts, delete history, a task page with parts).
# Computed-state only, so headless is sound.
sb1="$(new_sandbox)"
if boot_board "$sb1" "$P1"; then
  # ⚠️ NODE_PATH on the --seed extraction too: regress-a-night.js requires
  # playwright at module load, BEFORE it reaches the --seed branch, so pulling
  # the seed lines out needs the browser resolvable even though the seed itself
  # never launches one. Without it the extraction printed nothing and the board
  # came up with no project, and the task-page click just timed out.
  seed_js="$(NODE_PATH="$PW_NODE_PATH" node docs/browser-checks/regress-a-night.js --seed)"
  AGENT_WORKFORCE_DATA="$sb1/data" AGENT_WORKFORCE_WORKERS="$sb1/workers" \
    AGENT_WORKFORCE_LAUNCH="$sb1/launch" AGENT_WORKFORCE_PROJECTS="$sb1/projects" \
    AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb1/panes.txt" \
    node -e "$seed_js"
  run_one "regress-a-night" env KOSMOS_URL="http://127.0.0.1:$P1" node docs/browser-checks/regress-a-night.js
else
  FAILED+=("regress-a-night (server did not boot)")
fi

# 🛑 THE FIVE POSTING CHECKS ARE HANDED THIS HARNESS'S OWN SANDBOX ROOT.
#
# kosmos#1156 made those five refuse to run unless AGENT_WORKFORCE_DATA sits
# under a temp root, so a check that creates projects or completes first run
# cannot be pointed at somebody's real board. The guard was right and its
# PREMISE WAS FALSE: this script boots a sandboxed BOARD, then ran each check
# with only KOSMOS_URL passed through. The sandbox was real and the check could
# not see it, so all five refused and the 0.5.90 cut aborted at the page checks.
#
# ⚠️ WHAT THE GUARD CAN AND CANNOT KNOW, stated so nobody widens it wrongly: it
# answers "am I running in a sandboxed context", NOT "is the board I am about to
# POST to a fixture". A check cannot learn the second from its own environment.
# Passing this harness's sandbox root is therefore honest rather than a
# loophole: inside here, the first question's answer really is yes.
#
# ⇒ Each check gets the root of the board IT targets, not a nearby one, so the
#   variable also says something true about which fixture it is talking to.
# --- 2. render-projects: the project page's honesty rules -------------------
sb2="$(new_sandbox)"
if boot_board "$sb2" "$P2"; then
  run_one "render-projects" env AGENT_WORKFORCE_DATA="$sb2/data" node docs/browser-checks/render-projects.js \
    "http://127.0.0.1:$P2" "$sb2/shots" "$sb2"
  # #774: the consolidated view under each Agents layout, on the same board.
  # It seeds its own project inside $sb2 (and proves the server writes there),
  # so it stands alone if render-projects fails; puts the layout back after.
  run_one "render-consolidated-layouts" env AGENT_WORKFORCE_DATA="$sb2/data" node docs/browser-checks/render-consolidated-layouts.js \
    "http://127.0.0.1:$P2" "$sb2"
  # #1310 item 2: the projects grid card matches the agents board width, and a
  # long title truncates instead of widening the card.
  # ⚠️ LAST IN THIS BLOCK ON PURPOSE. It POSTs a long-titled project to seed
  # itself, and this board is shared with the two checks above; running it
  # after them means its fixture cannot reach their assertions. Anything added
  # here later should go ABOVE it, not below.
  run_one "render-grid-card-width" env AGENT_WORKFORCE_DATA="$sb2/data" KOSMOS_URL="http://127.0.0.1:$P2" \
    node docs/browser-checks/render-grid-card-width.js "$sb2/shots-gridwidth"
else
  FAILED+=("render-projects (server did not boot)")
fi

# #1303 H item 3: the member dialog. Self-contained -- it builds its own fixture
# fleet and runs the server in-process, so it needs no board from this harness
# and stands alone if the block above fails.
#
# 🛑 IT SHIPPED UNWIRED. The commit that added it (7b4e8a91) put the file in
# docs/browser-checks/ and never referenced it here, so it has never run once.
# The dialog it covers is Josh's own request, and on the day it landed the ONLY
# gate coverage of that area was render-projects still asserting the design it
# replaced: one check red for the wrong reason and its replacement not running.
# That is #812's "a check that is never run catches nothing at all", on a
# check one day old.
run_one "render-member-modal" node docs/browser-checks/render-member-modal.js

# --- 3. render-thread: the send-capable thread, on the fixture server --------
# #540: a board with a stand-in codex, so the add-an-OpenAI-account flow can
# run for real with no real key. HOME is the sandbox too, so the account it
# makes lands under $sb4/home/.codex-<label>, never beside the operator's.
sb4="$(new_sandbox)"
mkdir -p "$sb4/home"
cat > "$sb4/fake-codex" <<'FAKE'
#!/bin/bash
[ "$1" = login ] && [ "$2" = --with-api-key ] || exit 2
key=$(cat); mkdir -p "$CODEX_HOME"; printf '{"auth_mode":"apikey","OPENAI_API_KEY":"%s"}' "$key" > "$CODEX_HOME/auth.json"
FAKE
chmod +x "$sb4/fake-codex"
# #979: a stand-in Claude Code, for the same reason fake-codex exists.
# Until #979 the board's claudeBin ignored AGENT_WORKFORCE_HOME and so found
# the REAL claude on the operator's machine -- a sandbox reaching outside
# itself, which happened to make Claude read present here. The resolver now
# honours the sandbox home, so without this the check would silently start
# asserting against an absent Claude. Sealing the sandbox is the fix; making
# the resolver reach out again is not.
cat > "$sb4/fake-claude" <<'FAKE'
#!/bin/bash
# ⚠️ TWO ARMS, because TWO callers reach this stub now. `--version` is the
# runner probe. `auth status --json` is engine/subscription.js's live account
# check, which reaches this binary for the first time on this branch:
# claudeBinPath() was repointed at the resolver, which honours
# AGENT_WORKFORCE_HOME, so sandbox 4's check lands here instead of on the
# operator's real Claude. Answering with an explicit "not signed in" is the
# honest fixture for a sandbox that has no account; an empty answer would
# make the sandbox's verdict depend on how the parser treats silence.
[ "$1" = --version ] && { echo "claude 0.0.0-fake"; exit 0; }
# ⚠️ THE EXACT SHAPE, CAPTURED, NOT A PLAUSIBLE ONE. engine/subscription.js
# gates on `typeof parsed.loggedIn === 'boolean'` -- camelCase -- so a
# snake_case key falls through to "we could not make sense of the answer",
# which is the ambiguous verdict this fixture exists to avoid. The real
# command answers {"loggedIn": false, "authMethod": "none"} and exits 1;
# both halves are copied here, per the repo's fixture-discipline rule that a
# fixture is a capture and not a guess.
[ "$1" = auth ] && [ "$2" = status ] && { echo '{"loggedIn": false, "authMethod": "none"}'; exit 1; }
exit 0
FAKE
chmod +x "$sb4/fake-claude"
write_fleet "$sb4"
# A stand-in for api.openai.com/v1/models (#962): the badge now checks a key
# live, and a page gate must not send a fake key to OpenAI, nor depend on
# OpenAI answering. The stub accepts exactly the walk's key and refuses any
# other with OpenAI's own invalid_api_key shape, so both badge states are
# reachable from the check without a network.
P_OAI="$(free_port)"
AGENT_WORKFORCE_OPENAI_WALK_KEY="sk-proj-walkwalkwalkwalkwalkWALK" PORT="$P_OAI" node -e '
  const ok = "Bearer " + process.env.AGENT_WORKFORCE_OPENAI_WALK_KEY;
  require("node:http").createServer((q, r) => {
    const good = q.url === "/v1/models" && q.headers.authorization === ok;
    r.writeHead(good ? 200 : 401, { "content-type": "application/json" });
    r.end(JSON.stringify(good ? { data: [{ id: "gpt-4o" }] } : { error: { code: "invalid_api_key", message: "Incorrect API key provided" } }));
  }).listen(Number(process.env.PORT), "127.0.0.1");
' > "$sb4/openai-stub.log" 2>&1 &
SERVER_PIDS+=("$!")
AGENT_WORKFORCE_HOME="$sb4/home" AGENT_WORKFORCE_CODEX_BIN="$sb4/fake-codex" \
  AGENT_WORKFORCE_CLAUDE_BIN="$sb4/fake-claude" \
  AGENT_WORKFORCE_OPENAI_MODELS_URL="http://127.0.0.1:$P_OAI/v1/models" \
  AGENT_WORKFORCE_DATA="$sb4/data" AGENT_WORKFORCE_WORKERS="$sb4/workers" \
  AGENT_WORKFORCE_LAUNCH="$sb4/launch" AGENT_WORKFORCE_PROJECTS="$sb4/projects" \
  AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb4/panes.txt" \
  AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 \
  PORT="$P4" node ./server.js > "$sb4/server.log" 2>&1 &
SERVER_PIDS+=("$!")
if wait_up "$P4" "$sb4/server.log"; then
  run_one "render-accounts-openai" env AGENT_WORKFORCE_DATA="$sb4/data" node docs/browser-checks/render-accounts-openai.js "http://127.0.0.1:$P4"
else
  FAILED+=("render-accounts-openai (server did not boot)")
fi
# #529/#620: the doors, on two boards: gh absent (the no-install road, against a stub GitHub), and a stand-in gh that
# signs in when a marker file appears. No real gh and no real GitHub.
sb5="$(new_sandbox)"; sb6="$(new_sandbox)"
cat > "$sb6/fake-gh" <<'FAKE'
#!/bin/bash
M="${FAKE_GH_MARK:-/tmp/fake-gh-mark}"
if [ "$1" = auth ] && [ "$2" = status ]; then [ -f "$M" ] && { echo "github.com"; echo "  ✓ Logged in to github.com account walker (keyring)"; exit 0; } || { echo "not logged in" >&2; exit 1; }; fi
if [ "$1" = auth ] && [ "$2" = login ]; then echo "! First copy your one-time code: WALK-1234" >&2; echo "Open this URL to continue in your web browser: https://github.com/login/device" >&2; for i in $(seq 1 60); do [ -f "$M" ] && exit 0; sleep 0.5; done; exit 1; fi
exit 2
FAKE
chmod +x "$sb6/fake-gh"; rm -f "$sb6/mark"
cat > "$sb6/fake-vercel" <<'FAKE'
#!/bin/bash
M="${FAKE_VERCEL_MARK:-/tmp/fake-vercel-mark}"
if [ "$1" = whoami ]; then [ -f "$M" ] && { echo "vwalker"; exit 0; } || { echo "Error: not signed in" >&2; exit 1; }; fi
if [ "$1" = login ]; then echo "  Visit https://vercel.com/oauth/device?user_code=VRCL-5678" >&2; echo "Waiting for authentication..." >&2; for i in $(seq 1 60); do [ -f "$M" ] && exit 0; sleep 0.5; done; exit 1; fi
exit 2
FAKE
chmod +x "$sb6/fake-vercel"; rm -f "$sb6/vmark"
write_fleet "$sb5"; write_fleet "$sb6"
AGENT_WORKFORCE_GH_BIN=/nonexistent/gh AGENT_WORKFORCE_VERCEL_BIN=/nonexistent/vercel AGENT_WORKFORCE_GITHUB_DEVICE_URL="http://127.0.0.1:$P9/device" AGENT_WORKFORCE_GITHUB_TOKEN_URL="http://127.0.0.1:$P9/token" AGENT_WORKFORCE_GITHUB_VERIFY_URL="http://127.0.0.1:$P9/user" AGENT_WORKFORCE_DATA="$sb5/data" AGENT_WORKFORCE_WORKERS="$sb5/workers" AGENT_WORKFORCE_LAUNCH="$sb5/launch" AGENT_WORKFORCE_PROJECTS="$sb5/projects" AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb5/panes.txt" AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 PORT="$P5" node ./server.js > "$sb5/server.log" 2>&1 &
SERVER_PIDS+=("$!")
FAKE_GH_MARK="$sb6/mark" AGENT_WORKFORCE_GH_BIN="$sb6/fake-gh" FAKE_VERCEL_MARK="$sb6/vmark" AGENT_WORKFORCE_VERCEL_BIN="$sb6/fake-vercel" AGENT_WORKFORCE_CLOUDFLARE_VERIFY_URL="http://127.0.0.1:$P7/verify" AGENT_WORKFORCE_DATA="$sb6/data" AGENT_WORKFORCE_WORKERS="$sb6/workers" AGENT_WORKFORCE_LAUNCH="$sb6/launch" AGENT_WORKFORCE_PROJECTS="$sb6/projects" AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb6/panes.txt" AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 PORT="$P6" node ./server.js > "$sb6/server.log" 2>&1 &
SERVER_PIDS+=("$!")
if wait_up "$P5" "$sb5/server.log" && wait_up "$P6" "$sb6/server.log"; then
  curl -s -X POST "http://127.0.0.1:$P5/api/first-run/complete" >/dev/null; curl -s -X POST "http://127.0.0.1:$P6/api/first-run/complete" >/dev/null
  run_one "render-github-door" env AGENT_WORKFORCE_DATA="$sb6/data" node docs/browser-checks/render-github-door.js "http://127.0.0.1:$P5" "http://127.0.0.1:$P6" "$sb6/mark" "$sb6/vmark" "$P7" "$P9"
else
  FAILED+=("render-github-door (a server did not boot)")
fi
# #812: render-create-made presses the real Create button, so it refuses to
# run without both a dry-run server (nothing is actually started or written)
# and an explicit --yes-dry-run flag of its own -- neither is optional, and
# it is why this check needed a dedicated board rather than joining B8.
#
# CORRECTED (#1575): this used to end "(which runs without
# AGENT_WORKFORCE_DRY_RUN)". THAT IS FALSE AND IT ALREADY MISLED A REVIEW.
# B8 is booted by boot_board (the `boot_board "$sb7" "$P8"` call below), and
# boot_board sets AGENT_WORKFORCE_DRY_RUN=1 like every other board in this
# script. Measured: six real server boots here, all under dry-run, none
# without. Anyone designing around "the board that runs without dry-run" is
# looking for one that does not exist.
#
# What IS different about the dedicated board, measured rather than assumed:
# it omits three vars boot_board sets (TMUX_BIN, FAKE_PANES, CONFIG_ROOT),
# for the reason the next paragraph gives. Whether that, or the fact that B8
# is shared by eight other checks while this one presses a real Create
# button, is the reason it was split out, I have not established and am not
# asserting. The false clause is removed; the true rationale is whatever the
# surrounding #812 notes say.
#
# Restated against 4bf7d95's real
# ending by Ice Cream Kitty (#826) before this PR wired it in; proven
# standalone (18/18) before this line was written, with exactly the env vars
# below -- no tmux/fake-panes vars, because dry run never reaches tmux and
# the standalone proof ran clean without them. P10 comes from pick_ports's
# own dedup, not a standalone free_port() call: at this point in the script
# P3 and P8 are already-picked but not-yet-bound "live reservations" with no
# socket behind them, so a lone free_port() here could collide with either
# and strand an unrelated check's boot later in the run (#633's own class).
sb8="$(new_sandbox)"
AGENT_WORKFORCE_DATA="$sb8/data" AGENT_WORKFORCE_WORKERS="$sb8/workers" \
  AGENT_WORKFORCE_LAUNCH="$sb8/launch" AGENT_WORKFORCE_PROJECTS="$sb8/projects" \
  AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 \
  PORT="$P10" node ./server.js > "$sb8/server.log" 2>&1 &
SERVER_PIDS+=("$!")
if wait_up "$P10" "$sb8/server.log"; then
  curl -s -X POST "http://127.0.0.1:$P10/api/first-run/complete" >/dev/null
  run_one "render-create-made" node docs/browser-checks/render-create-made.js "http://127.0.0.1:$P10" --yes-dry-run
else
  FAILED+=("render-create-made (a server did not boot)")
fi
# #616: every check that was green on a clean main in #545's count, and was
# not wired, now runs here. Two groups. The first shares one board with
# first run completed through the product's own route (on a fresh board the
# first-run pane sits on top of Settings and a check clicks a paragraph).
# render-offline-note goes LAST on that board on purpose: it kills the server
# it loads from, and anything scheduled after it on the same board reads as
# a dead check. The second group boots its own fixture server in-process
# and runs bare. A check nobody asks a question of is a script; these are
# now asked one every release.
sb7="$(new_sandbox)"
if boot_board "$sb7" "$P8"; then
  curl -s -X POST "http://127.0.0.1:$P8/api/first-run/complete" >/dev/null
  B8="http://127.0.0.1:$P8"
  B8_PID="${SERVER_PIDS[${#SERVER_PIDS[@]}-1]}"   # the board just booted, for render-offline-note to take away by pid (#708)
  run_one "contrast"            env KOSMOS_URL="$B8" node docs/browser-checks/contrast.js
  run_one "named-controls"      env KOSMOS_URL="$B8" node docs/browser-checks/named-controls.js
  run_one "render-create-form"  node docs/browser-checks/render-create-form.js "$B8"
  run_one "render-found-undo"   node docs/browser-checks/render-found-undo.js "$B8"
  run_one "render-made-endings" node docs/browser-checks/render-made-endings.js "$B8"
  run_one "render-rename-say"   node docs/browser-checks/render-rename-say.js "$B8"
  run_one "render-role-limit"   node docs/browser-checks/render-role-limit.js "$B8"
  run_one "render-role-order"   node docs/browser-checks/render-role-order.js "$B8"
  run_one "render-reload-toast"  env KOSMOS_URL="$B8" node docs/browser-checks/render-reload-toast.js "$sb7/shots-reload"
  run_one "render-updates-stale" env KOSMOS_URL="$B8" node docs/browser-checks/render-updates-stale.js "$sb7/shots-updates"
  run_one "render-switch-states" env KOSMOS_URL="$B8" node docs/browser-checks/render-switch-states.js
  # ⚠️ THE FIRST-RUN FLOW WAS NOT COVERED BY THIS RUNNER AT ALL. render-first-run
  # exists, renders every step in both schemes and carries its own planted-failure
  # control, but it hardcoded port 4399 so it could never take the runner's
  # kernel-chosen one. It is the path every new person walks; it now runs here.
  run_one "render-first-run"    env KOSMOS_URL="$B8" node docs/browser-checks/render-first-run.js "$sb7/shots-firstrun"
  # #1553: the launch must not flash the agents view before the first-run gate
  # resolves. Proven green + fails-without-the-cover before wiring (the #812 rule).
  run_one "render-boot-no-flash" env KOSMOS_URL="$B8" node docs/browser-checks/render-boot-no-flash.js
  run_one "render-theme-toggle"  env KOSMOS_URL="$B8" node docs/browser-checks/render-theme-toggle.js "$sb7/shots-toggle"
  # #812: 15 checks were green on a clean main but never asked. render-full-width
  # first (#778 restated it, Ice Cream Kitty, #814; ready now); more join in
  # later batches as each is proven, not all at once (#812's own reasoning:
  # adding checks to a gate a concurrent merge can flip is a real cost, not
  # only a benefit -- see tools/browser-checks-freeze-758's #824 freeze, which
  # this batching relies on to make a red here mean something).
  run_one "render-full-width"   env KOSMOS_URL="$B8" node docs/browser-checks/render-full-width.js "$sb7/shots-fullwidth"
  run_one "render-offline-note"  env KOSMOS_URL="$B8" node docs/browser-checks/render-offline-note.js "$sb7/shots-offline" "$B8_PID"
else
  for n in contrast named-controls render-create-form render-found-undo render-made-endings render-rename-say render-role-limit render-role-order render-reload-toast render-updates-stale render-switch-states render-theme-toggle render-full-width render-offline-note; do FAILED+=("$n (server did not boot)"); done
fi
# #812 batch 2 (retried after the first attempt found four checks that
# assumed compatibility with B8's fixture instead of verifying it -- those
# stay unwired until their own fixture needs are met). render-memory-controls
# is genuinely self-contained (its own mktemp sandbox, its own fleet.install,
# requires server.js in-process) and was proven standalone before being added
# here, matching this loop's existing "boots its own fixture server, runs
# bare" shape exactly.
# render-model-change joins the same way: Ice Cream Kitty's #832 seeded its
# own launch file under the sandboxed launch dir (#619) and set its own
# AGENT_WORKFORCE_DRY_RUN=1, so it is genuinely self-contained the same as
# render-memory-controls. Proven standalone (9/9, matching #832's own proof)
# before being added here.
# render-head-row joins the same way (#1043): its own mktemp roots, its own
# OS-chosen port, server.js in-process, runs bare. Proven standalone 9/9 --
# including its 700px negative control, which is the arm that makes the other
# eight mean anything: a row check that cannot report "not one row" is
# decoration, and this one was MEASURED reporting it.
# render-room-scroll joins the same way (#1037, the resize trigger): own mktemp
# roots, own OS-chosen port, server.js in-process, runs bare. Proven standalone
# 15/15, and proven RED with the fix disabled -- the arm that matters reports
# Josh's own symptom, 46px of the newest messages under the fold.
# #1440: three of the four checks that guard Josh's own 0.5.97 review items had
# NEVER RUN ONCE. They read as coverage on a directory listing and provided none.
# All three join the same way as the batch above: own mktemp roots, own OS-chosen
# port, server.js in-process, runs bare.
#
# 🛑 EACH WAS PROVEN GREEN STANDALONE **AND PROVEN RED WITH ITS OWN FIX DISABLED**,
# because the debt list's own warning is the real risk rather than caution: a check
# that has never run is as likely to be wrong as the code it guards.
#
#   render-agent-lines  (#1303 A item 3)  9/9 green; RED at line-height 1.6 on
#     .ltitle/.lstate, reporting Josh's symptom as uneven leading, 3.5px vs 5.3px.
#     ⚠️ Worth knowing before anyone edits it: with the fix disabled its FIRST arm
#     still PASSES, at exactly its own <= 3.5 threshold. The evenness arm is what
#     caught the regression. One assertion there is a rounding from being unable to
#     see what it guards, and only running the red arm reveals that.
#   render-long-title   (#1303 F)         8/8 green; RED SEPARATELY ON BOTH of the
#     two rules its fix comment says are needed, with DISJOINT failure sets:
#     dropping `flex-shrink: 0` gives 137px -> 119px, dropping the .dname
#     nowrap/ellipsis takes the header 20px -> 40px. Both numbers are the ones that
#     fix's own comment recorded when it was written.
#   render-project-rows (#1303 E)        12/12 green; RED with `display: contents`
#     off .pjcard-h, the rule its comment calls the whole trick: the status leaves
#     the agents line (183 vs 201) and the row grows to 66px.
#
# 📌 render-found-count, the fourth on #1440, is NOT here and stays in NOT_WIRED.
# Its own header says an in-process srv.start(0) cannot reach ?fr-step=6; it needs
# a boot_board sandbox block, which is a different piece of work.
for n in live-connect render-agent-nav render-busy-line render-head-row render-room-scroll render-made-before render-memory-words render-org-drag render-pjsettings render-settings-nav render-talk-search render-talk render-tasks render-url-state render-memory-controls render-model-change render-alltasks render-composer-reset render-agent-lines render-long-title render-project-rows; do
  run_one "$n" node "docs/browser-checks/$n.js"
done
# --- the rich board: four checks that could not be wired for want of a fixture
# --- (#1072). Each was verified green against this exact shape by hand first;
# --- what none of them had was a board in the RUNNER that could show them
# --- their subject. A fresh-board green and an in-sequence green are different
# --- claims, so these run here, in position, and not on my word.
sbr="$(new_sandbox)"
if boot_board_rich "$sbr" "$P11"; then
  run_one "render-org-chart"   env KOSMOS_URL="http://127.0.0.1:$P11" node docs/browser-checks/render-org-chart.js
  run_one "render-not-running" env KOSMOS_URL="http://127.0.0.1:$P11" node docs/browser-checks/render-not-running.js
  run_one "render-list-row"    env KOSMOS_URL="http://127.0.0.1:$P11" node docs/browser-checks/render-list-row.js
  # ⚠️ TAKES ITS BASE AS AN ARGUMENT, not KOSMOS_URL, unlike its neighbours.
  # And it belongs on the RICH board specifically: it fails loudly when the
  # unknown-memory badge or the list row's unknown cell is absent, and those
  # need the not-running profiles this fixture carries. It only reads computed
  # style, so running it in position after three checks that have touched the
  # board is sound, and in-sequence is the claim worth having (#1072).
  run_one "render-fields"      node docs/browser-checks/render-fields.js "http://127.0.0.1:$P11"
  # ⚠️ SAFE ON A SHARED BOARD, and the reason is not obvious from the clicks: it
  # presses Add and Undo, but BOTH /api/found-agents and /api/connect-agent are
  # route-stubbed with r.fulfill, so nothing leaves the page and no agent is
  # created. I first read the two .click() calls and wrongly called it unsafe --
  # the question was never "does it click" but "does anything leave the page".
  run_one "render-found-board" env HEADED=0 node docs/browser-checks/render-found-board.js "http://127.0.0.1:$P11"
  run_one "render-survival"    env KOSMOS_URL="http://127.0.0.1:$P11" node docs/browser-checks/render-survival.js "$sbr/shots-survival"
else
  FAILED+=("render-org-chart render-not-running render-list-row render-fields render-found-board render-survival (rich board did not boot)")
fi

# --- render-update-toast: SELF-CONTAINED, so it sits outside the board groups.
# It picks its own free ports and spawns its own board and release host, which
# is why it needs no $Pn and no sandbox from this script. Verified standalone on
# 2026-08-27 (exit 0, "TOAST DRIVE OK"); wired here so it runs in position like
# everything else rather than only when somebody remembers it (#1072).
run_one "render-update-toast" env SHOT_DIR="$RUN_DIR/shots-toast" node docs/browser-checks/render-update-toast.js

# --- click-first-run: the whole wizard, clicked like a person -------------
# 🛑 ITS OWN BOARD, NOT THE SHARED RICH ONE. `fresh()` deletes the first-run
# flag and the you.json before EVERY section, and the walk completes onboarding
# and opens the create panel. On a board its siblings also use, that is a check
# rewriting the fixture underneath them.
# ⚠️ AND IT NEEDS A FLEET: the step-6 ending is chosen by fleetCount, so on an
# empty board it takes the neutral two-action arm and the adopt assertions fail
# for a reason that is about the fixture. boot_board_rich supplies one.
# The FLAG argument is the sandboxed first-run.json, so nothing touches the
# operator's own.
sbc="$(new_sandbox)"
if boot_board_rich "$sbc" "$P12"; then
  run_one "click-first-run" env KOSMOS_URL="http://127.0.0.1:$P12" HEADED=0 \
    node docs/browser-checks/click-first-run.js "$sbc/data/AgentWorkforce/first-run.json"
else
  FAILED+=("click-first-run (board did not boot)")
fi

# #1440, the fourth of the four checks guarding Josh's 0.5.97 review items, and
# the one that could not join the stem loop. Its own header says why and it is
# right: an in-process `srv.start(0)` renders "Create your first agent" at
# `?fr-step=6`, so a check built that way times out on a screen that is fine.
# It takes a BOARD, so it gets one here.
#
# 🔑 IT SHARES NOTHING AND MUTATES NOTHING, which is why a plain board is enough.
# Every API it needs is stubbed with `page.route` (`/api/found-agents`,
# `/api/first-run`, `/api/connect-agent`), and its single click lands on an
# intercepted route, so the request never reaches the server. It cannot disturb a
# sibling and a sibling cannot disturb it.
#
# 🛑 PROVEN GREEN 16/16 AND PROVEN RED ON THE #1346 FIX ITSELF: scoping removed
# from `document.querySelectorAll('#firstrun .fr-foundrow')`, the trailing line
# reads "60 agents" under a screen showing 30. That is Josh's own picture, N above
# and 2N below, reproduced by the check on demand.
#
# ⭐ Its twelfth assertion is the one that makes the rest mean anything, and it is
# worth not breaking: it asserts the DOCUMENT holds more rows than the SCREEN (60
# vs 30). Without that arm a scoped count and an unscoped count agree, and the
# whole check passes on the broken page.
sbfc="$(new_sandbox)"
if boot_board "$sbfc" "$P13"; then
  run_one "render-found-count" env HEADED=0 node docs/browser-checks/render-found-count.js "http://127.0.0.1:$P13"
else
  FAILED+=("render-found-count (board did not boot)")
fi

sb3="$(new_sandbox)"
if boot_thread_server "$sb3" "$P3"; then
  run_one "render-thread" env AGENT_WORKFORCE_DATA="$sb3/data" node docs/browser-checks/render-thread.js \
    "http://127.0.0.1:$P3" "$sb3/shots" "$sb3/server.log"
else
  FAILED+=("render-thread (server did not boot)")
fi

# --- report -----------------------------------------------------------------
sec "browser checks summary"
log "ran:     ${RAN[*]:-none}"
[ "${#RETRIED[@]}" -gt 0 ] && log "retried: ${RETRIED[*]}  (repeated retries are a flake to fix, not to accept)"
if [ "${#FAILED[@]}" -gt 0 ]; then
  log "FAILED:  ${FAILED[*]}"
  log "why, from each check's own output (the full log has the rest):"
  for r in ${REASONS[@]+"${REASONS[@]}"}; do log "  $r"; done
  exit 1
fi
log "all page checks passed"
exit 0
