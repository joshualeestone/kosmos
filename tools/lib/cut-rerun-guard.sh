#!/usr/bin/env bash
# #2006: a cut runs the whole suite under the load the cut itself creates, so a
# load-sensitive concurrency test can red a release for a reason unrelated to
# the change. run-tests.sh already PRESCRIBES the discriminator beside every red
# ("A red that is green alone is contention, not the change; rerun the failing
# file alone before calling it a defect") -- this ENCODES it so the cut applies
# it automatically, instead of a person doing it by hand. Removing that human
# judgement call is the point: the reasoning "concurrency test, cut-load,
# probably flaky" is available before any rerun is done and is right often
# enough to become a habit, and the day a real regression lands it gets the same
# shrug.
#
# THE ASYMMETRY THAT MAKES THIS SAFE (#2006): contention manufactures false
# REDS, never false greens. A single GREEN when a file is re-run ALONE proves the
# test can pass, so the suite red was starvation, not the change. A red that
# PERSISTS in isolation is real. So the only thing this ever dismisses is a file
# that goes green alone; it aborts on anything that stays red, and on anything it
# cannot isolate (a green under load needs no defence, so it is never touched).
#
# Sourced by release.sh under `set -euo pipefail`, so every command here is
# written to be errexit-safe (no bare command whose non-zero exit should not
# abort). bash 3.2 compatible (macOS system bash): no mapfile/readarray.

# Echo the failing NODE test files named in a suite log, one per line, sorted
# unique. node --test prints, inside its "failing tests:" block, a FLUSH-LEFT
# `test at <file>:<line>:<col>` line before each failing test. Measured on node
# 26 for BOTH shapes: a test-level assertion failure (`test at
# server.doorflight-1618.test.js:NN`) and a whole-file failure under process
# isolation (`test at web.url-state.test.js:1:1`). Stack-trace frames are
# INDENTED ("      at ..."), so the `^` anchor excludes them, and a passing test
# produces no such line. `|| true` so "no matches" is empty output, not an error.
kosmos_failing_test_files() {
  local log="$1"
  [ -f "$log" ] || return 0
  { grep -oE '^test at [^ ]+\.test\.js' "$log" 2>/dev/null || true; } \
    | sed 's/^test at //' | sort -u
}

# #2006 (shell-stage extension): a post-node stage red (fail_count == 0). The node
# suite passed and then a later stage failed. run-tests.sh runs, after a green node
# suite: (1) `yarn -s test:shell` -- a SEQUENTIAL &&-chain of shell tests, several
# of which are the most contention-sensitive tests in the whole suite because they
# walk process ancestry and count live `bash tools/browser-checks.sh` runs
# (test-browser-run-guard.sh's "does not refuse itself" and "#1391 descendant not
# excluded"), so an UNRELATED agent's live page layer on this shared box reds them
# with symptoms that read exactly like broken code; then (2) the repo-local
# browser-check gate, which is FAIL-SOFT on the cut's frozen trunk (returns 0 when
# it cannot diff origin/main...HEAD or there is no web/ change) and so cannot red
# here. The coverage assertion fires BEFORE the node suite, so a coverage red has
# no node tally and is caught by the empty-tally abort (never reaches this branch).
# Therefore a fail-0 red during a cut is the SHELL stage, and the SAME asymmetry the
# node path relies on holds: contention manufactures false REDS, never false greens,
# so a single GREEN re-run of the shell stage alone proves the red was starvation.
#
# Re-run the shell stage ALONE (`yarn -s test:shell`, no 4400-test node load
# competing for the box, so an unrelated browser run has room to finish), up to
# `max` attempts with a short pause between them (external contention clears with
# TIME, not with removing the cut's own parallelism -- test:shell is sequential, it
# has none). Dismiss ONLY on a green; a persistent red is a real shell-test failure
# and aborts. Returns 0 (contention, dismiss) or 1 (real red, abort).
#
# SEAMS (so the test proves both verdicts without a real 2-minute suite):
#   KOSMOS_SHELL_RERUN_CMD   the command run in $repo (default `yarn -s test:shell`)
#   KOSMOS_SHELL_RERUN_SLEEP seconds to pause between attempts (default 5; 0 in tests)
# Written errexit-safe (release.sh sources this under set -euo pipefail): the rerun
# runs in an `if ( ... )` subshell so its non-zero does not abort, and the
# inter-attempt pause is guarded by an `if` (a bare `&&` list could trip errexit).
kosmos_shell_stage_rerun_verdict() {
  local repo="$1" max="${2:-3}" attempt rc
  local cmd="${KOSMOS_SHELL_RERUN_CMD:-yarn -s test:shell}"
  local sleep_s="${KOSMOS_SHELL_RERUN_SLEEP:-5}"
  echo "isolation-rerun: node reported 0 failing tests, so the node suite passed and this red is a POST-node stage. The browser-check gate is fail-soft on the cut's frozen trunk (it cannot red here) and a coverage mismatch fires before the node suite (no tally -> aborted above), so this is the SHELL stage (yarn test:shell)."
  echo "isolation-rerun: re-running the shell stage ALONE (no node-suite load), so an unrelated live page layer has room to clear (contention makes false reds, never false greens; a single green alone proves the shell stage passes)."
  attempt=1
  while [ "$attempt" -le "$max" ]; do
    if ( cd "$repo" && eval "$cmd" ) >/dev/null 2>&1; then rc=0; else rc=$?; fi
    if [ "$rc" -eq 0 ]; then
      echo "  shell stage: PASSED alone on attempt $attempt/$max -> contention, not a defect. Dismissed."
      echo "isolation-rerun: the shell-stage red was contention, not the change. The cut proceeds (#2006)."
      return 0
    fi
    echo "  shell stage: still red alone on attempt $attempt/$max (exit $rc)."
    attempt=$((attempt + 1))
    if [ "$attempt" -le "$max" ] && [ "$sleep_s" -gt 0 ]; then sleep "$sleep_s"; fi
  done
  echo "  shell stage: red in isolation across all $max attempts -> a real shell-test failure, not contention. The cut aborts."
  return 1
}

# Re-run each failing file ALONE (a single file => no cross-file concurrency =>
# no self-contention) up to `max` attempts. A pass on ANY attempt dismisses that
# file as contention. Returns 0 when EVERY failing file went green alone (the
# suite red was contention; the cut may proceed) and 1 otherwise -- a file that
# stayed red across all attempts, or a named file that is missing.
#
# Two red shapes reach here: a NODE test-file failure (fail_count > 0), handled by
# the file-by-file rerun below; and a POST-node stage red (fail_count == 0 -- the
# node suite passed, then a later stage failed), handled by the shell-stage rerun
# (#2006 shell extension, kosmos_shell_stage_rerun_verdict). A red that names no
# node file AND has no readable node tally at all (a killed suite, a coverage
# mismatch that fired before the node suite) still aborts: it cannot be proven a
# dismissable stage. Narrates every rerun and the reason to stdout, so the cut's
# log shows it re-ran and why (the card's acceptance).
kosmos_isolation_rerun_verdict() {
  local log="$1" repo="$2" max="${3:-3}"
  local line files file attempt rc dismissed fail_count testat_count

  # A COMPLETENESS cross-check, so an incomplete parse cannot false-green. The
  # whole safety of dismissing rests on having found EVERY failure: if a real
  # regression were reported in a shape with no flush-left "test at <file>" line
  # WHILE another failing file is dismissable, the missed one would sail through
  # as "contention". node prints an aggregate "ℹ fail N" summary and one "test
  # at" line per failing test (measured, node 26), so cross-check the two:
  #  - no readable tally (the suite was killed before printing one) => cannot
  #    prove completeness => abort;
  #  - node reported ZERO failing tests => the node suite PASSED and the red is a
  #    POST-node stage. run-tests.sh runs, after a green node suite, `yarn -s
  #    test:shell` (the &&-chain of shell tests) then the repo-local browser-check
  #    gate. The gate is FAIL-SOFT on the cut's frozen trunk (it returns 0 when it
  #    cannot diff origin/main...HEAD or there is no web/ change), so it cannot red
  #    here; a coverage mismatch fires BEFORE the node suite, so it yields no tally
  #    at all and is caught by the empty-tally abort above, never reaching this
  #    branch. So a fail-0 red during a cut is the SHELL stage, which the same
  #    asymmetry makes dismissable -- hand it to kosmos_shell_stage_rerun_verdict
  #    (a stray "test at" echoed by a shell test is irrelevant: this branch never
  #    reads the node file list). This is the #2006 shell extension;
  #  - fewer "test at" lines than node's fail count => a failure is in a shape
  #    this does not parse => abort.
  # A node red proceeds to the file-by-file rerun only when fully accounted for; a
  # fail-0 red proceeds to the shell-stage rerun. When unsure (no tally, incomplete
  # parse) this aborts exactly as the cut would without the feature: it only ever
  # makes the cut more lenient when PROVEN safe.
  fail_count="$(grep -E '^ℹ fail [0-9]+' "$log" 2>/dev/null | tail -1 | grep -oE '[0-9]+' | tail -1 || true)"
  # MUST use the SAME '\.test\.js' anchor as kosmos_failing_test_files: a failing
  # test whose "test at" line names a NON-.test.js path (node emits e.g. "test at
  # engine/helper.js:5:3" when a failing test() is registered from a required
  # helper) is dropped from `files` and cannot be re-run, so it must also NOT be
  # counted here -- otherwise it inflates testat_count to meet fail_count and the
  # completeness gate passes while a real failure is silently unaccounted for.
  # Counting the narrow pattern makes such a line drop testat_count below
  # fail_count -> abort. (Raw line count, not ${#files[@]}: files is deduped, so a
  # multi-test file legitimately has more lines than files; the count must match
  # node's per-test fail tally, and it does when every failing test is in a .test.js.)
  testat_count="$({ grep -cE '^test at [^ ]+\.test\.js' "$log" 2>/dev/null || true; })"
  if [ -z "$fail_count" ]; then
    echo "isolation-rerun: could not read node's 'fail N' tally from the log (the suite may have been killed before printing one), so the failure list cannot be proven complete. Not dismissing; the cut aborts."
    return 1
  fi
  if [ "$fail_count" -eq 0 ]; then
    # #2006 shell extension: the node suite passed, so this is a post-node stage
    # red -- the SHELL stage (the browser-check gate is fail-soft on the frozen
    # trunk; a coverage mismatch has no tally and aborted above). Re-run the shell
    # stage alone: a green proves the red was contention.
    if kosmos_shell_stage_rerun_verdict "$repo" "$max"; then return 0; else return 1; fi
  fi

  files=()
  while IFS= read -r line; do
    [ -n "$line" ] && files+=("$line")
  done < <(kosmos_failing_test_files "$log")

  if [ "${#files[@]}" -eq 0 ] || [ "$testat_count" -lt "$fail_count" ]; then
    echo "isolation-rerun: found $testat_count 'test at' failure line(s) for ${#files[@]} file(s), but node reported $fail_count failing test(s), so at least one failure is in a shape this does not parse. Not dismissing; the cut aborts."
    return 1
  fi

  echo "isolation-rerun: the suite was red on ${#files[@]} node test file(s) ($fail_count failing test(s)): ${files[*]}"
  echo "isolation-rerun: re-running each ALONE (contention makes false reds, never false greens, so a single green alone means the suite red was starvation)."

  # The rerun is a bare `node --test <file>` (exactly run-tests.sh:190's "rerun
  # the failing file alone"), so it does NOT inherit run-tests.sh's per-run
  # TMPDIR or coverage-assertion harness. The suite's tests self-sandbox (every
  # store-using test sandboxes before requiring; see run-tests.sh), so this is
  # correct today; a test that depended on harness-provided setup could behave
  # differently alone, which would show as a red that stays red -> abort (safe).
  for file in "${files[@]}"; do
    if [ ! -f "$repo/$file" ]; then
      echo "  $file: NOT FOUND under $repo, so it cannot be re-run in isolation and cannot be dismissed. The cut aborts."
      return 1
    fi
    dismissed=0
    attempt=1
    while [ "$attempt" -le "$max" ]; do
      if ( cd "$repo" && node --test -- "$file" ) >/dev/null 2>&1; then
        rc=0
      else
        rc=$?
      fi
      if [ "$rc" -eq 0 ]; then
        echo "  $file: PASSED alone on attempt $attempt/$max -> contention, not a defect. Dismissed."
        dismissed=1
        break
      fi
      echo "  $file: still red alone on attempt $attempt/$max (exit $rc)."
      attempt=$((attempt + 1))
    done
    if [ "$dismissed" -ne 1 ]; then
      echo "  $file: red in isolation across all $max attempts -> a real failure, not contention. The cut aborts."
      return 1
    fi
  done

  echo "isolation-rerun: every failing file passed when re-run alone -> the suite red was contention, not the change. The cut proceeds (#2006)."
  return 0
}
