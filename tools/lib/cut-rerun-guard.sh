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
  local line files file attempt rc dismissed

  files=()
  while IFS= read -r line; do
    [ -n "$line" ] && files+=("$line")
  done < <(kosmos_failing_test_files "$log")

  if [ "${#files[@]}" -eq 0 ]; then
    echo "isolation-rerun: the red names no node test file ('test at <file>' absent), so it is a shell test, the browser-check gate, the coverage assertion, or a could-not-run. That is not isolable here and must not be auto-dismissed; the cut aborts."
    return 1
  fi

  echo "isolation-rerun: the suite was red on ${#files[@]} node test file(s): ${files[*]}"
  echo "isolation-rerun: re-running each ALONE (contention makes false reds, never false greens, so a single green alone means the suite red was starvation)."

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
