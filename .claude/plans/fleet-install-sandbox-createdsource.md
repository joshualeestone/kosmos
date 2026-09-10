# fleet-install-sandbox-createdsource -- make the test fleet installer hermetic against created-never-run agents

## Problem

The 0.6.55 re-cut aborted at step 3 (the full suite) on `engine/heartbeat.test.js`
(`rowsFrom maps the REAL board stateConfidence field`, line 143: `mapped.length` was 2,
expected 1). The cut's own #2006 isolation-rerun ran it alone 3x, red each, so the cut
correctly refused to treat it as contention.

It is a mortals-env-dependency, the 4th in this cut's saga: the test reads LIVE machine
state. `engine/status.js`'s `snapshot()` builds `agents` from panes (via `setPaneSource`)
AND, when the created-never-run roster source is wired (#1078; `server.js` wires it live
from `createdroster.make()`, which reads launchd jobs + worker dirs on disk), appends those
created-but-never-run agents (`status.js:6454`). `test-support/fleet.js`'s `install()`
sandboxes `setPaneSource` and `setPaneCapture` but NEVER touches `setCreatedSource`. So on a
box carrying real created-but-never-run agents -- exactly what an operator does with #2678's
"Add my agents from an existing Kosmos" import -- those agents leak into every fixture's
`snapshot().agents`.

Reproduced deterministically on mortals: wiring `createdSource` the way `server.js` does,
then `fleet.install([['mara','stopped']])`, returns **7** rows (mara + 6 real imported
agents), not 1. It only reds where such agents exist (mortals, mid-import), which is why
#2662's CI (clean box) was green, `heartbeat.test.js` passes on Agent1s, and #2675's earlier
cut passed (mortals had zero created-never-run agents then).

## Fix

`test-support/fleet.js` must sandbox the created-never-run seam too, mirroring how it already
sandboxes the pane seam:

- `install()` sets `status.setCreatedSource(() => [])` (a fixture describes running panes
  only, so the created arm is empty), beside `setPaneSource`.
- The failure-simulation helpers (`blind`/`unreadable`/`refuses`) set it too, so they stay
  hermetic.
- `restore()` nulls it, so a fixture cannot leak into a later test sharing the `status`
  singleton.

With the fix, the same wired-`createdSource` reproduction returns 1 (mara only), and
`heartbeat.test.js` passes. This makes every test that uses `fleet.install` immune to a live
import, so the cut is immune too (Splinter: Josh can keep importing on the cut box).

## Systemic follow-up (after 0.6.55, endorsed by Splinter)

This is the 4th "cut gate reads live state" in one cut (block-delivery you.json, install-gate
#2124 running-app, and now fleet.install created-agents). The systemic answer is to run the
cut as a SEPARATE macOS user on mortals with no live board/roster in that session, killing the
whole class. To be filed as a named initiative-card post-0.6.55; Splinter surfaces it to Josh
as a resourced initiative.

## Verification

- Leak reproduced (7 rows) and closed (1 row) on both mortals and Agent1s with `createdSource`
  wired.
- `engine/heartbeat.test.js` passes.
- Full validation suite green (must confirm the created-roster #1078 test and every
  fleet.install consumer still pass).
