#!/bin/bash
# #1818: the runner re-execs itself from the frozen copy, and a cut-short run is
# loud, not silently green.
#
# WHAT THE BUG WAS. bash reads a script by byte offset. Editing
# tools/browser-checks.sh WHILE it ran corrupted the parent's read and died with
# a syntax error on an innocent line -- and, dying before the summary, left no
# FAILED line and no run-log entry, so a reader grepping for FAIL read the dead
# run as green (the a-killed-suite-prints-a-passing-tally shape). The freeze at
# browser-checks.sh:~128 moved where the CHECKS read code from; it could not move
# the file bash was already reading THIS script from ($0, the mutable source).
#
# THE FIX, in two parts, each with an arm below:
#   1. Re-exec the runner from the frozen copy. On a direct run from a branch
#      (symbolic HEAD) the parent freezes, then runs the checks in a CHILD whose
#      $0 is the frozen worktree -- an immutable path nobody edits -- so a mid-run
#      edit to the source cannot corrupt the child's read.
#   2. A cut-short banner. A run that dies after the checks begin but before the
#      summary now says so out loud and records an "incomplete" run-log line,
#      instead of leaving silence a reader misreads as a pass.
#
# WHY THIS FORCES ITS OWN SYMBOLIC-HEAD WORKTREE. The re-exec fires only when
# HEAD is a symbolic ref (a branch). CI checks out a DETACHED HEAD, where the
# re-exec path never runs -- so a test that leaned on the ambient checkout would
# silently never exercise arm 1 in CI (the "a conditional path cannot be tested
# where its condition never fires" trap). So arm 1 creates its own throwaway
# branch worktree off HEAD and runs from there, guaranteeing symbolic HEAD
# regardless of how the suite was checked out.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

T="$(mktemp -d "${TMPDIR:-/tmp}/test-reexec-1818.XXXXXX")"
TESTWT="$T/branch-wt"
TESTBR="tmp-reexec-1818-$$"
cleanup_test() {
  # Remove the throwaway worktree + branch first (before rm -rf $T), each
  # best-effort so a half-made fixture never leaves a registered worktree behind.
  git -C "$REPO" worktree remove --force "$TESTWT" >/dev/null 2>&1 || true
  git -C "$REPO" branch -D "$TESTBR" >/dev/null 2>&1 || true
  git -C "$REPO" worktree prune >/dev/null 2>&1 || true
  rm -rf "$T"
}
trap cleanup_test EXIT

fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# An empty runtime dir + a private HOME so resolve_pw finds NO Playwright
# (neither ~/work/pw-runtime nor the npx cache), so both re-exec arms take the
# clean KOSMOS_SKIP_BROWSER_CHECKS early exit (browser-checks.sh:~308) without
# launching a browser. KOSMOS_HARNESS_IGNORE_CUT=1 makes the parent's live-run
# guard deterministic regardless of what else is on this Mac.
NOPW="$T/no-pw"; mkdir -p "$NOPW"
export HOME="$T/home"; mkdir -p "$HOME"
# KOSMOS_PW_NODE_PATH="" forces resolve_pw to fall through to the (now empty)
# runtime dir + npx cache, so a stray value in the ambient env cannot make the
# test launch a real browser.
common_env=(KOSMOS_HARNESS_IGNORE_CUT=1 KOSMOS_SKIP_BROWSER_CHECKS=1 KOSMOS_PW_RUNTIME_DIR="$NOPW" KOSMOS_PW_NODE_PATH=)

# ---------------------------------------------------------------------------
# ARM 1: re-exec fires on a symbolic-HEAD run, and the checks run from a FROZEN,
#        immutable path -- not from the source $0 a mid-run edit could corrupt.
# ---------------------------------------------------------------------------
if git -C "$REPO" worktree add -q -b "$TESTBR" "$TESTWT" HEAD 2>"$T/wt.err"; then
  out="$(cd "$TESTWT" && env "${common_env[@]}" bash "$TESTWT/tools/browser-checks.sh" 2>&1)"; rc=$?

  [ "$rc" -eq 0 ] \
    && pass "a symbolic-HEAD run exits 0 on the clean no-Playwright skip" \
    || fail "symbolic-HEAD run exit ($rc), out: $out"

  has "$out" "Frozen at" \
    && pass "the parent froze the tree" \
    || fail "no 'Frozen at' line (parent did not freeze): $out"

  has "$out" "Running from the frozen runner copy" \
    && pass "the runner RE-EXECED from the frozen copy (the child ran, not the parent)" \
    || fail "no re-exec: the child never announced running from the frozen copy: $out"

  # The frozen runner copy the child ran from must be a temp freeze dir, NOT the
  # source worktree bash could otherwise be reading a mutable $0 from. Prove it
  # names a kosmos-bc-freeze path and does NOT name the source worktree.
  frozen_line="$(printf '%s\n' "$out" | grep 'frozen runner copy' | head -1)"
  if has "$frozen_line" "kosmos-bc-freeze" && ! has "$frozen_line" "$TESTWT/tools"; then
    pass "the child's runner path is the immutable frozen copy, not the source \$0"
  else
    fail "the child ran from a path that is not a distinct frozen copy: $frozen_line"
  fi

  # The clean skip must NOT trip the cut-short banner: CHECKS_STARTED was never
  # set, so a legitimate early skip stays quiet (no false 'did NOT complete').
  ! has "$out" "did NOT complete" \
    && pass "a legit early skip does NOT false-fire the cut-short banner" \
    || fail "the cut-short banner false-fired on a clean skip: $out"
else
  fail "could not create the branch worktree fixture: $(cat "$T/wt.err" 2>/dev/null)"
fi

# ---------------------------------------------------------------------------
# ARM 2: a run cut short AFTER the checks begin is LOUD, not silently green --
#        it prints the banner AND records an 'incomplete' run-log line.
#        KOSMOS_BC_FROZEN_RUNNER=1 runs the checks in-process (no second freeze/
#        re-exec), so this arm exercises the banner in one process; the test seam
#        KOSMOS_BC_TEST_CUTSHORT=1 reaches the CHECKS_STARTED state a real kill
#        leaves, without a browser.
RUNLOG="$T/runs.log"
out="$(cd "$REPO" && env "${common_env[@]}" \
  KOSMOS_BC_FROZEN_RUNNER=1 KOSMOS_BC_TEST_CUTSHORT=1 KOSMOS_BROWSER_RUN_LOG="$RUNLOG" \
  bash "$REPO/tools/browser-checks.sh" 2>&1)"; rc=$?

[ "$rc" -eq 137 ] \
  && pass "a cut-short run exits non-zero (137), not 0" \
  || fail "cut-short exit was $rc, expected 137: $out"

has "$out" "did NOT complete" \
  && pass "the cut-short banner fires (the dead run is loud, not silently green)" \
  || fail "no cut-short banner on an aborted run: $out"

has "$out" "NOT a pass" \
  && pass "and the banner says explicitly it is NOT a pass" \
  || fail "the banner did not say it is not a pass: $out"

if [ -f "$RUNLOG" ] && has "$(cat "$RUNLOG")" "incomplete-exit137"; then
  pass "the run-log records the cut-short as 'incomplete-exit137', so it leaves a trace"
else
  fail "the run-log has no incomplete entry: $(cat "$RUNLOG" 2>/dev/null || echo '<no log>')"
fi

# ---------------------------------------------------------------------------
# ARM 3: the frozen-runner child does NOT refuse itself on the live-run guard.
#        The parent cleared the field once and stays alive as a page layer that
#        already passed; without the KOSMOS_BC_FROZEN_RUNNER skip at :110 the
#        child would see a live page layer and refuse, so a symbolic-HEAD run
#        could never complete. A live probe drives both arms:
#          CONTROL  (no FROZEN_RUNNER): the guard runs and REFUSES  -- proves the
#                   probe is effective and can return the dangerous answer.
#          SUBJECT  (FROZEN_RUNNER=1):  the guard is skipped and the run PROCEEDS
#                   to the clean skip -- proves the :110 skip is what unblocks it.
probe="$T/probe-live"
printf '#!/bin/sh\nprintf "99999 bash tools/browser-checks.sh\\n"\n' > "$probe"; chmod +x "$probe"

# CONTROL: no FROZEN_RUNNER, no harness override, a live probe -> must refuse.
out="$(cd "$REPO" && env KOSMOS_SKIP_BROWSER_CHECKS=1 KOSMOS_PW_RUNTIME_DIR="$NOPW" \
  KOSMOS_PW_NODE_PATH= KOSMOS_BC_PROBE="$probe" \
  bash "$REPO/tools/browser-checks.sh" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && has "$out" "browser-checks.sh"; then
  pass "CONTROL: a live page layer refuses the run (the probe can return the dangerous answer)"
else
  fail "CONTROL did not refuse on a live probe (rc=$rc): $out"
fi

# SUBJECT: same live probe, but FROZEN_RUNNER=1 -> guard skipped, run proceeds.
out="$(cd "$REPO" && env KOSMOS_SKIP_BROWSER_CHECKS=1 KOSMOS_PW_RUNTIME_DIR="$NOPW" \
  KOSMOS_BC_FROZEN_RUNNER=1 KOSMOS_BC_PROBE="$probe" \
  bash "$REPO/tools/browser-checks.sh" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && ! has "$out" "another page layer"; then
  pass "SUBJECT: the frozen-runner child skips the live-run guard (does not refuse itself)"
else
  fail "the frozen-runner child was refused by the guard (rc=$rc): $out"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "runner-reexec (#1818): 0 failures"
else
  echo "runner-reexec (#1818): $fails FAILURE(S)"
fi
exit "$fails"
