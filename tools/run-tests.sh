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

# --- what the machine was doing, taken before the first test ---------------
seen_before() {
  local lines=()
  # A live board on the default port, with whose it is: cwd says whether it is
  # the main checkout (#708's deliberate one) or a worktree.
  local pid cwd
  for pid in $(lsof -nP -iTCP:16180 -sTCP:LISTEN -t 2>/dev/null); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    lines+=("a live board on :16180, pid $pid, running from ${cwd:-an unknown directory}")
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
  local load cores
  load="$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}')"
  cores="$(sysctl -n hw.ncpu 2>/dev/null)"
  [ -n "$load" ] && lines+=("1-minute load $load on ${cores:-?} cores")
  printf '%s
' "${lines[@]}"
}
BEFORE="$(seen_before)"

# --- the suite, unchanged -----------------------------------------------------
node --test engine/*.test.js *.test.js "$@"
NODE_STATUS=$?
if [ "$NODE_STATUS" -eq 0 ]; then
  yarn -s test:shell
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
