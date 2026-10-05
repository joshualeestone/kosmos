# tmpleaks2-5334: the browser-check temp homes (#5334, slice 2)

## Finished means
A browser-check run no longer leaves `kosmos-bc-home-` or `aw-thread-config-` folders behind when its servers are
stopped with SIGTERM (the runner's `kill`). Measured, not assumed.

## What was measured (Agent1s, 2026-10-05 18:3x CDT)
- 248 `kosmos-bc-home-` folders in $TMPDIR, all empty, exactly 3 per hour-bucket for two days: one leak per full run,
  not random kills. 77 `aw-thread-config-` folders.
- lib-sandbox-home.js alone cleans up on a normal exit, process.exit(3) and SIGTERM (0 left); only SIGKILL leaks.
- docs/browser-checks/thread-server.js booted in a sandbox and stopped with SIGTERM left exactly 3 `kosmos-bc-home-`
  and 1 `aw-thread-config-`: the field pattern.
- Cause: its SIGTERM listeners were test-support/remove-at-end.js's (stands aside when another listener exists, then
  trusts 'exit') and engine/remote.js's (removes itself and RE-RAISES, so it never seizes the exit code). The re-raise
  hits no listener, the process dies by the default action, and 'exit' never fires, so nothing was swept.
- The card's second named source, render-reload-toast.js, makes no temp folder (it only contains the word "whatsnew");
  the `whatsnew-` folders came from engine/whatsnew.test.js, fixed in slice 1 (newest leftover 15:27, before it merged).

## The change
test-support/remove-at-end.js: when its handler stands aside for a foreign listener, it listens ONCE more. On the
re-raised signal it is the only listener left, so it sweeps and re-raises in turn. A foreign handler that keeps the
process alive (or ends it with process.exit) behaves as before: the sweep waits for 'exit'.

## Rejected
- Changing engine/remote.js (production): its re-raise is deliberate and correct for the board; the board registers no
  other 'exit' work, so production is unaffected.
- Sweeping unconditionally at the signal: would delete a sandbox a foreign handler is still using (the existing
  "a file's own SIGTERM handler decides" test pins that it must not).
- A start-up sweep of old empty folders: hides the leak instead of stopping it.

## Verified
- thread-server repro: patched 0 left, exit by SIGTERM kept (143); main's helper 4 left.
- test-support.tmpscope.test.js: 13/13; with main's helper swapped in, both new #5334 arms fail (control), and the
  old-shape control arm passes in both.

## Weakest premise
That thread-server is the only browser-check process with this listener pair. The 3-per-run count matches it exactly,
but a check that loads lib-sandbox-home and something that re-raises would now also be fixed by the same change.
SIGKILL still leaks, as the card says; nothing in-process can fix that.
