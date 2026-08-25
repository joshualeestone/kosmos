# render-reload-toast pins ENGINE_STALE, so it stops reading the machine's own file-freshness (#758-shaped, escalated by Splinter 01:00 CDT)

Branch `toast-engine-pin-758`. Splinter's candidate, confirmed by reading the code rather than testing the theory directly (no reproduction attempted -- the mechanism is unambiguous from the source).

## What happened

`render-reload-toast.js` (docs/browser-checks) was green in the 0.5.25 release gate at ~00:28-00:38, then red six-for-six (buttons:0 on every state) in a run twenty minutes later, with no code between the two runs that touches the reload-toast path. Mona Lisa correctly ruled out her own branch and correctly ruled out main by diffing every commit between the two runs.

## The mechanism

- `tools/browser-checks.sh` (`boot_board`, ~line 313) boots ONE `node server.js` for a whole batch of checks (contrast through render-offline-note), launched from the SHARED, mutable checkout -- not a frozen worktree the way `release.sh`'s own build step is (#597/#611).
- `server.js` `engineFreshness()` (line 75) reports `staleSince` non-null the moment ANY file in `require.cache` has an mtime newer than `ENGINE_STARTED_AT` (when THIS spawned process started). It exists to catch a real production condition: code changed on disk under a running server. It has no way to tell that condition apart from "a release cut, or another agent's merge, touched this same shared checkout while the check suite happened to be running against it."
- `web/index.html`'s `renderUpdateToast` (line 8872) checks `ENGINE_STALE` FIRST (line 8883) and short-circuits to the "Kosmos changed on disk" toast when it is set -- by design (#338): the engine state outranks both the update-offer and page-stale states, because restarting settles all three.
- `render-reload-toast.js` loads a REAL page against the booted board, so the page's own poll sets the real, global `ENGINE_STALE` from a real `/api/status` read (`web/index.html:9927`) before the check's `pg.evaluate` block calls `renderUpdateToast(...)` to drive the offer/stale states it actually wants to test. It never resets `ENGINE_STALE`.
- If the shared checkout's files were touched by ANYTHING (a merge, a release step, a rebase) while this batch's board has been running, the very next `/api/status` poll flips `ENGINE_STALE` non-null, and every subsequent `renderUpdateToast` call in THIS check draws the engine-changed toast (no buttons, different text) instead of the offer/stale pair under test -- exactly the six-for-six, buttons:0 shape Mona Lisa measured.

This is a fixture blind spot, not a product bug: `renderUpdateToast`'s engine-outranks-both rule (#338) is correct product behavior. The check is testing a DIFFERENT toast pair (#270: offer vs. reload) and was never scoped to also exercise the engine-stale variant -- so it should not be reading whatever `ENGINE_STALE` value happens to be true of the machine it runs on.

## What changed

`docs/browser-checks/render-reload-toast.js`: before driving each state, the check's `pg.evaluate` block now also sets `ENGINE_STALE = null` (pinned, not inherited), so a coincidentally-stale spawned server can never leak the engine-changed toast into a check whose whole point is the OTHER toast pair.

## Finished when

- A control proves the bug: with `ENGINE_STALE` forced non-null before driving a state (simulating the race), the CURRENT check would fail (or draw the wrong toast); after the fix, it passes regardless of `ENGINE_STALE`'s real value.
- `render-reload-toast.js` passes against the shared-checkout board the same way it did before, and independently of whether the checkout was touched during the run.
- Sibling checks that also call `renderUpdateToast` (there are none as of this pass -- `render-updates-stale.js` is a separate toast, driven by `bakedVersion`/`pageIsStale` directly, unaffected) are not touched.

## Not in this change

Freezing the whole browser-check suite's boot against a detached/frozen tree the way `release.sh` freezes its build step (#597/#611) -- the deeper, more general fix Splinter's original message gestured at ("door.rs is queued to do the same"). That is #758 in full; this is the one check actively costing cut attempts tonight, fixed at the check that is red right now.
