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

# Re-run each failing file ALONE (a single file => no cross-file concurrency =>
# no self-contention) up to `max` attempts. A pass on ANY attempt dismisses that
# file as contention. Returns 0 when EVERY failing file went green alone (the
# suite red was contention; the cut may proceed) and 1 otherwise -- a file that
# stayed red across all attempts, a named file that is missing, or NO
# identifiable node test-file failure at all (a shell test, the browser-check
# gate, the coverage assertion, or a could-not-run: not isolable here, so not
# dismissable). Narrates every rerun and the reason to stdout, so the cut's log
# shows it re-ran and why (the card's acceptance).
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
  #  - node reported ZERO failing tests => the red is a LATER stage (a shell
  #    test, the browser-check gate, or the coverage assertion; run-tests.sh runs
  #    those only after the node suite is green), which is not an isolable node
  #    file -- and a stray "test at" echoed by such a stage must NOT be mistaken
  #    for the failure => abort;
  #  - fewer "test at" lines than node's fail count => a failure is in a shape
  #    this does not parse => abort.
  # The ONLY path that proceeds to a rerun is a red that IS a node test failure,
  # fully accounted for. When unsure this aborts exactly as the cut would without
  # the feature: it only ever makes the cut more lenient when PROVEN safe.
  fail_count="$(grep -E '^ℹ fail [0-9]+' "$log" 2>/dev/null | tail -1 | grep -oE '[0-9]+' | tail -1)"
  testat_count="$({ grep -cE '^test at ' "$log" 2>/dev/null || true; })"
  if [ -z "$fail_count" ]; then
    echo "isolation-rerun: could not read node's 'fail N' tally from the log (the suite may have been killed before printing one), so the failure list cannot be proven complete. Not dismissing; the cut aborts."
    return 1
  fi
  if [ "$fail_count" -eq 0 ]; then
    echo "isolation-rerun: node reported 0 failing tests, so this red is a later stage (a shell test, the browser-check gate, or the coverage assertion), not an isolable node test file. Not dismissing; the cut aborts."
    return 1
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
      if ( cd "$repo" && node --test "$file" ) >/dev/null 2>&1; then
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
