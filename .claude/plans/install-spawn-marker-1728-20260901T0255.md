# kosmos#1728 (marker arm) -- durable in-flight install marker

## Problem

`engine/update.js` `beginInstall` spawns the software-update installer as
`/bin/sh -c 'curl -fsSL "$1" | sh; ...'` with `detached: true`, `stdio: 'ignore'`
and `child.unref()`. Once spawned it has left: a killed board, a Ctrl-C, an
aborted suite or a crash stops nothing, and no stream records what it did. The
ONLY witness of an install was `logs/install.status`, and that file is written by
the spawned shell **only when it finishes**. So an install interrupted mid-flight
left **no trace at all** -- no exit listener (the process is gone) and no status
file (the shell never reached its `printf`). A board coming back after an
interrupted install cannot know an install was ever in flight.

kosmos#1728 is about making the detached installer **recallable**. That has two
parts, and only one is safe to build solo:

- **The recall/kill design** (drop `detached`, or track a pid and kill it, or a
  resumable installer) changes how the installer runs and can corrupt an install
  mid-write. That decision is Josh's and stays **flagged**, not built here.
- **The observability arm (this change)** is add-only and non-corrupting: make an
  interrupted install *observable* so a person or the board can know one was in
  flight. You cannot verify what leaves no trace; this builds the trace.

## What this change does (add-only)

1. `installStartedFile()` -> `logs/install.started`, and `markInstallStarted(startedAt)`
   which writes the ISO start stamp to it (best-effort; a board that cannot write
   the marker must never fail an install to record one).
2. `markInstallStarted` is called from `wireChild` -- the shared choke point both
   the real spawn and an injected test runner reach -- so the marker is written
   the moment a child exists, synchronously, microseconds after spawn.
3. The spawned shell command gains `; rm -f "$4"` and the marker path rides as the
   `$4` positional, so the shell removes the marker when the attempt finishes
   (success or clean failure -- the tail always runs). A **surviving** marker
   therefore means the attempt was interrupted before it could restart the board.
4. The reader is refactored so the marker feeds the existing `lastAttempt()`
   channel: `readStatusRaw()` (parse code+stamp, no filter), `readStatusRecord()`
   (the old failure reader, code-0 seeds nothing), `readStartedRecord()` (a
   surviving marker -> an "interrupted" record, code null), and `seedFromDisk()`
   which picks the more-recent of the two by ISO start stamp. `lastAttemptView()`
   calls `seedFromDisk`.
5. **Same-attempt suppression:** `readStartedRecord` suppresses the marker when a
   status record exists for the SAME start stamp -- the shell reached its status
   write, so that attempt finished and the marker is only residue from the tiny
   window between the status write and the `rm`. A different (earlier) status does
   NOT suppress: the marker is then a genuine later interruption.

## Explicitly NOT touched

`detached: true`, `stdio: 'ignore'`, `child.unref()` -- the recall/kill design,
which is Josh's decision and stays flagged. This change only adds a witness.

## Tests

`engine/update.marker-1728.test.js` (12): marker written on a child-shaped spawn,
control that a non-child result writes none, surviving-marker -> interrupted,
the real shell command lifted from source removes the marker + writes status,
the `$4` wiring, newest-wins picker + its control, the pre-#1728 status behaviours
preserved, and the same-attempt suppression (success-killed-before-rm is not
interrupted) + its control (a later marker after an older success IS interrupted).
`engine/update.test.js`'s spawn-shape security assertion updated for the new
`; rm -f "$4"` tail and the `startedMarker` positional (URL still $1, never
interpolated).

## Verification

Full suite `bash tools/run-tests.sh` green.
