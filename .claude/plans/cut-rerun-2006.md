# Plan: cut-rerun-2006

Addresses **kosmos#2006** (item 3, which is the card's Acceptance).

## Problem

A release cut runs the whole suite under the load the cut itself creates (the single
most loaded moment on the box: 18 agents on one host, plus the cut parallelising its own
382-file suite). So any load-sensitive concurrency test can red a release for a reason
unrelated to the change. Measured today: the 0.6.25 cut, carrying a fleet-down messaging
fix, aborted on ONE test (`#1618 server.doorflight-1618.test.js`, 293ms starved vs 2886ms
alone). Rerun alone: 4/4 green. Cost: a full cut cycle, ~11 minutes, fleet-down throughout.

The deeper danger is not the lost time: a gate that reds for reasons unrelated to the
change trains everyone to dismiss reds, and the day a real regression lands it gets the
same shrug.

## The asymmetry this rests on (from the card)

Contention manufactures false REDS, never false greens. So a single GREEN when a file is
re-run ALONE proves the test can pass and the suite red was starvation; a red that
persists in isolation is real. A green under load needs no defence and is never touched.

## What finished looks like (the card's Acceptance)

A cut does not abort on a test that passes when re-run alone, and says in its log that it
re-ran and why.

## Approach

`run-tests.sh:190` already PRESCRIBES this discriminator beside every red ("A red that is
green alone is contention, not the change; rerun the failing file alone before calling it
a defect") but a human has to apply it. Encode it so the cut applies it automatically,
removing the human judgement call (the actual hazard).

- **`tools/lib/cut-rerun-guard.sh`** (new): `kosmos_failing_test_files` extracts the
  failing NODE test files named in the suite log (node prints a flush-left
  `test at <file>:<line>:<col>` before each failing test, measured on node 26 for both a
  test-level assertion failure and a whole-file failure under process isolation; indented
  stack frames are excluded by the `^` anchor). `kosmos_isolation_rerun_verdict` re-runs
  each failing file ALONE (single file = no cross-file concurrency) up to 3 attempts and
  returns 0 (contention, cut proceeds) only if EVERY failing file goes green alone; else 1
  (abort). bash 3.2 compatible, errexit-safe (sourced under `set -euo pipefail`).
- **`tools/release.sh`**: sources the lib (unguarded, like cut-guard.sh) and, at the
  step-3 suite gate, runs the discriminator before aborting on a red suite; logs the
  rerun narration + a machine-readable verdict line to `cut-suite-runs.log`.

## Why it is safe / the abort direction

The ONLY thing dismissed is a file that goes green alone. It aborts on: a file that stays
red across all attempts (real), a named file missing from the repo (cannot isolate), and a
red that names NO node test file (a shell test, the browser-check gate, the coverage
assertion, or a could-not-run: run-tests.sh gates those AFTER the node suite, so a node red
is pure and anything non-node is not auto-dismissed). So a real regression, and anything
this cannot isolate, still aborts the cut.

## Scope

Card items 1 (harden #1618's own harness) and 2 (redefine what "quiet the box" must mean
for #1962) are related but out of scope here; the Acceptance is item 3. If the
isolation-rerun does not make #1618's own flakiness moot, that is its own follow-up.

## Test

`tools/test-cut-rerun-guard.sh` (wired into `test:shell`): 11 assertions covering
extraction (incl. ignoring stack frames and a no-node-file red), the contention-dismiss
path, and the controls that return the dangerous answer -- a file that stays red alone,
a missing file, a no-node-file red, and a mixed case (one real among a dismissable) all
return abort. Also `bash -n tools/lib/cut-rerun-guard.sh` and the existing
`bash -n tools/release.sh` syntax checks.

## Validation

- `bash tools/test-cut-rerun-guard.sh` -> ALL PASS (11).
- `bash -n` on the lib and release.sh: clean.
- No `web/` change (no #1720 gate); added a `test-*.sh` not a `*.test.js` (the #1934
  node-coverage count is unaffected); no node engine change.
- Full `test:shell` + node suite via GitHub CI.
