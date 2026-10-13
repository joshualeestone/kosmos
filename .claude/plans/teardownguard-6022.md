# teardownguard-6022: browser checks survive a poll in flight at teardown

Card: kosmos#6022. Split with Baron by agreement (2026-10-12 23:49 and 23:55 CDT): his #6023 (the 0.7.44 re-cut) adds
docs/browser-checks/lib-close-quietly.js and changes render-rename-say, render-connlost-reconnect-3410,
render-made-endings and render-swarm-ui-3564; this branch does everything else, and those four files' handlers only
after #6023 merges.

## Finished looks like
No browser check can crash after its assertions pass because a route handler's fetch (or the answer after it) was
in flight when the browser closed, and a guard test refuses the shape coming back.

## What changes
- `browser-checks-teardown-guard-6022.test.js` (new): in every docs/browser-checks/*.js route handler that calls
  `<param>.fetch(`, that fetch and every later `<param>.fulfill/continue/fetch(` sit inside an open `try {`.
  Comments are blanked first (strings kept); a closed inner try inside an open outer one counts. Fixtures pin each
  direction (bare, fixed, fulfill after the try, closed try, nested, comment, fixture-only, bare-parameter arrow).
- 21 checks: each fetching handler's body wrapped in `try { ... } catch { await r.abort().catch(() => {}); }`, with
  every fulfill/continue awaited inside it. No assertion, fixture value or route pattern changed (diff reviewed for
  removed check/assert/route lines: none, except one mobile-shots route line that only gained `.catch(() => {})`).
  mobile-shots.js's handlers that fetch through its fetchBoard helper were hardened by hand.

## Decisions
- **The try is the rule, not an unroute.** Measured (2026-10-12, a page polling every 20 ms through a 300 ms
  handler, browser closed mid-poll; script in the PR): bare handler exit 1 in 5 of 5 ("Request context disposed",
  TargetClosedError); try/abort exit 0 in 5 of 5 with NO unroute, and 5 of 5 with page.close() before
  browser.close(). An unroute before browser.close() misses a check that closes its page or context first (Baron's
  review on #6023 found four such). Rejected: the card's second guard rule (require unrouteAll), which would have
  forced edits in 80+ files with routes but no fetch and still miss the early-close shape.
- Abort in the catch, not an empty catch: a real failure mid-check aborts the request and the check fails fast at
  its next assertion instead of hanging to a timeout.
- Fixture-only handlers (fulfill with no await before it) are left alone: nothing is in flight.
- The card's reference files (render-login-expiry-3532, render-updates-stale, render-engine-restart-4408) unroute
  but had the fetch or the answer outside a try; they were hardened too, for the fail-fast half and so the guard has
  one rule.

## Weakest premise
The guard reads source text. A handler written as a named function defined elsewhere, or fetching through a helper
(mobile-shots fetchBoard), is not seen; a handler's span runs to the next `.route(`, so a nearby helper reusing the
parameter name is read as part of it (fails red, safe). Behaviour under the cut's real load is reasoned from the
mechanism repro, not measured per check under load.

## Tests
- The guard: fixtures pass; red on main (22 files), and after this branch red only on #6023's four files until it
  merges and they are hardened here.
- Every changed check run on this branch (self-booting ones directly; render-update-abort-2055 with the runner's
  board).
