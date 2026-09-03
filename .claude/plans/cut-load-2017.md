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

`release.sh` sources the lib (unguarded, under set -e, like the sibling libs) and calls
`kosmos_gate_or_abort` ONCE, at the ENTRY to the gated phase (before step 3). A quiet box
there plus the held reservation covers step 3 AND step 3b, and the entry is where the
leftover load that caused the incident lives (present from the cut's start). It does NOT
re-check before step 3b: the 1-min load there is still inflated by this suite's own
just-finished processes, so a second wait would stall on the cut's own residual rather than
external load. `kosmos_gate_or_abort` lives in the lib (so the abort DECISION is unit-tested,
not only bash -n'd inline) and, on a timeout, narrates a LOAD-attributed stop and returns 1,
which release.sh turns into `exit 1` -- an honest, actionable stop, never a phantom test-red.
In the common case the box quiets (an abandoned job finishes or is reaped, possibly by
#2018) and the gate runs on a clean box, so the false-red source is removed.

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

**Known residual (safe-direction, deliberate):** the gate fires ONCE at the phase entry,
so a heavy EXTERNAL job that STARTS during step 3 can still saturate the box by step 3b,
which is not re-checked. This is accepted rather than fixed with a naive pre-3b wait,
because at 3b the 1-min load is dominated by the cut's own just-finished parallel suite, so
a re-check would false-WAIT on the cut's own residual, not external load. The residual is
only ever a false-RED at 3b (a wasted cut), never a false-green (load makes only false
reds), so it is an honest partial fix, not a regression. The incident this card was filed
for -- leftover load present from the cut's start -- IS covered by the entry gate. A
foreign-load check at 3b (measuring load minus the cut's own process tree) is a possible
follow-up if mid-cut external load proves a real problem.

## Test

`tools/test-cut-load-guard.sh` (wired into `test:shell`): 19 assertions -- threshold
(default + override), the float compare (over / not / fail-open), the wait's three paths
(quiet-immediately, persistent-saturation timeout with load attribution, and
saturated-then-quiets-after-a-poll via a load-reader override), `kosmos_gate_or_abort`
(quiet -> proceed, saturated -> abort with the load-attributed narration -- the release.sh
integration point, so the abort decision is unit-tested), and an errexit-safety guard (a
direct set -euo pipefail caller returns cleanly).

## Validation

- `bash tools/test-cut-load-guard.sh` -> ALL PASS (19).
- `bash -n` clean on the lib and release.sh.
- No `web/` change (no #1720 gate); added a `test-*.sh` not a `*.test.js` (the #1934
  node-coverage count is unaffected); no node engine change.
- Full `test:shell` + node suite via GitHub CI (the box is release-held locally).
