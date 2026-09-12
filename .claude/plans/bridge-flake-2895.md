# #2895: codex-report-bridge.test.js flakes with a byte-identical executed path

## Problem
`codex-report-bridge.test.js` intermittently records `seen.length === 0` (the bridge
"reported nothing at all") on branches whose diff provably does not touch any file the
test executes. It fires only under full-suite load, costs a whole suite run each time,
and defeats the standard contention check (not in the diff, passes alone, passes on main).

## Root cause (measured, not reasoned)
The test's `drive()` helper spawns the bridge with **`execFileSync`**, then waits 300ms and
closes the stub board. `execFileSync` blocks this process's event loop for the entire life
of the child. But the bridge's report is a `fetch` to the stub board **running in this same
process**, so the stub can only answer while the loop is blocked if libuv happens to service
the default loop's socket handle from inside `spawnSync`'s internal wait. Measured on this
box (node v26.8.1, the pinned version):

- same-process fetch to a local server: ~4-49ms, always.
- child-via-`execFileSync` fetch to the parent's server, sequential: delivered but ~5.5s
  each (serviced only near the bridge's 5s `TIMEOUT_MS` abort).
- child-via-`execFileSync`, 4-way concurrent (suite-like): **13/16 deliver nothing** -> the
  fetch hits the 5s abort, `seen.length === 0`, a false failure.

The 300ms timer is irrelevant: the request is not lost, it is never *answered* in time.

## The fix
Spawn the bridge with **async `execFile`** (`promisify`d) instead of `execFileSync`, and
resolve when the child exits. This keeps the parent's event loop free, so the stub answers
concurrently with the child's fetch. Awaiting the child is a sufficient barrier: the bridge
exits only after its fetch settles, and on success the stub pushes to `seen` before it writes
the response (before the fetch resolves, before the child exits) -- so a delivered report is
already in `seen` when the child returns, and an ignored event (no fetch) leaves it empty.
No timer, no race.

This is the codebase's **established, documented convention**: `cli.presents-token.test.js`,
`cli.presents-board-token-1968.test.js`, and `engine/updating-988.test.js` each already spawn
async with an explicit "ASYNC, NEVER execFileSync -- it blocks the event loop" comment. The
bridge test was the single file that regressed to `execFileSync` + a fixed timer.

## Verification
- Fixed test: green 5/5 in isolation (~1s each), 12/12 parallel copies, 0 fails.
- Control on the real bridge: sync `drive` 13/16 zero under 4-way concurrency; async
  `drive` 200/200 delivered under 16-way concurrency in 2.8s.

## Rejected alternatives
- Raise the 300ms close timer: the card already measured 3000ms still flakes; the request is
  never answered, not answered late.
- Raise the bridge's 5s `TIMEOUT_MS`: changes product behaviour to paper over a test-harness
  bug, and would only make a hung drive slower, not deliver it.

## Weakest premise
The comment says servicing degrades "under load"; more precisely it degrades with concurrent
in-process drives and scheduler pressure on `spawnSync`'s internal loop-servicing. The exact
libuv mechanism is not fully pinned, but the fix does not depend on it: async spawn removes
the dependency on that servicing entirely, which the 200/200-vs-13/16 control proves.
