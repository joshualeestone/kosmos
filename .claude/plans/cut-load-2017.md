# Plan: cut-load-2017

Addresses **kosmos#2017** (the "reserve against concurrent load" half; the sibling
reap-abandoned-work half is #2018, Ice Cream Kitty's).

## Problem

A release cut runs its gated steps -- the node suite (step 3) and the headless browser
checks (step 3b) -- on a box that OTHER work can be saturating. #1962's machine
reservation blocks other agents' SUITES, but not an arbitrary heavy background job. On
2026-09-03 eight leftover `while :; mktemp` loops from a CLOSED investigation (#1988)
drove fseventsd to ~70% CPU and box load to 24, starving the 0.6.25 cut's browser gate at
step 3b. It cost a full cut cycle. #2006's isolation-rerun does not help: as Baron put it,
"it still runs INSIDE the same starved box."

## The asymmetry (same as #2006)

Load manufactures false REDS, never false greens. So waiting for a quiet box can only make
a red more trustworthy; it can never hide one.

## What finished looks like (the card)

A cut does not abort a gated step because a heavy background job saturated the box, and the
reason (which job, what load) is in the cut's log.

## Approach: a load pre-check that WAITS for a quiet box

`tools/lib/cut-load-guard.sh` (new):
- `kosmos_cut_load_threshold` -- the load at/below which a gate may run. Default 1.5x the
  core count; `KOSMOS_CUT_MAX_LOAD` overrides.
- `kosmos_box_load_1min` -- the 1-min load (`sysctl vm.loadavg`); `KOSMOS_FAKE_LOAD`
  overrides (tests, and a machine with no sysctl).
- `kosmos_load_over_threshold` -- an awk float compare (bash 3.2 has none); an
  unreadable/empty load is treated as NOT over (fail open: never block a cut on a load we
  cannot read).
- `kosmos_top_cpu_consumers` -- names what is loading the box (attribution).
- `kosmos_wait_for_quiet_box <label> [max_wait_s] [poll_s]` -- if the box is above
  threshold, wait (polling, naming the top consumer) until it quiets or `max_wait_s`
  (default 600) elapses. Returns 0 if quiet (or it quieted), 1 on timeout.

`release.sh` sources the lib (unguarded, under set -e, like the sibling libs) and calls the
guard before step 3 and before step 3b. On a timeout it stops with a LOAD-attributed
message ("reap the named job and re-cut") -- an honest, actionable stop, never a phantom
test-red or browser flake. In the common case the box quiets (an abandoned job finishes or
is reaped, possibly by #2018) and the gate runs on a clean box, so the false-red source is
removed.

## Why stop-on-timeout rather than proceed

Proceeding into a persistently-saturated box just false-reds the gate (the very thing this
prevents) and wastes the gate run first. Stopping BEFORE the gate, with the offending job
named, is the cheaper and more honest outcome. The generous default wait (600s) means the
common transient case never reaches the stop; it also gives a human (or #2018's reap) time
to clear the offender while the log names it.

## Scope

This is the concurrent-LOAD half. It does not reap abandoned background work (that is
#2018) and does not change the cut's own suite parallelism (that is #2006's isolation
rerun). The three compose: #2018 keeps abandoned load from accumulating, this waits for a
quiet box before gating, and #2006 handles the suite's own-parallelism contention.

## Test

`tools/test-cut-load-guard.sh` (wired into `test:shell`): 13 assertions -- threshold
(default + override), the float compare (over / not / fail-open), and the wait's three
paths (quiet-immediately, persistent-saturation timeout with load attribution, and
saturated-then-quiets-after-a-poll via a load-reader override), plus an errexit-safety
guard (a direct set -euo pipefail caller returns cleanly).

## Validation

- `bash tools/test-cut-load-guard.sh` -> ALL PASS (13).
- `bash -n` clean on the lib and release.sh.
- No `web/` change (no #1720 gate); added a `test-*.sh` not a `*.test.js` (the #1934
  node-coverage count is unaffected); no node engine change.
- Full `test:shell` + node suite via GitHub CI (the box is release-held locally).
