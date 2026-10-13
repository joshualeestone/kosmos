# renamesay-teardown: render-rename-say crashed after every assertion passed (aborted the 0.7.44 cut)

**Branch:** `renamesay-teardown` · Found by: the 0.7.44 staging cut, step 3b, 2026-10-12 23:36 CDT (frozen 46d024a49).

## The defect
render-rename-say passed all 12 assertions, twice, and then crashed: `TargetClosedError: route.fetch: Request context
disposed` at its `/api/status` route handler, so the check exited non-zero and the cut aborted. The handler was added by
#6010 (dupname-5957, mine): it fetches the real status poll and sets one flag. The page polls on a timer, so a poll can
be in flight when the check closes the browser; the handler's `r.fetch()` then rejects, unhandled, and Node exits 1.
It passed CI on #6010; under the cut's load (Mortals load 4.5) a poll was in flight at teardown both times.

## The fix
- The handler's body is in a try/catch: a poll the closed page no longer wants is dropped quietly. `fulfill` is awaited,
  so its rejection is caught too.
- Before `browser.close()`, `page.unrouteAll({ behavior: 'ignoreErrors' })`, the form Playwright's own error message
  recommends and three other checks already use (render-updates-stale, render-engine-restart-4408,
  render-login-expiry-3532).
No assertion changes.

## Proof (mechanism, measured)
A standalone Playwright page polling `/api/status` every 50 ms (each answer 300 ms), closed mid-poll: the handler as on
main exits 1 with the same `Request context disposed` error 3 of 3; the fixed handler plus unrouteAll exits 0, 3 of 3.
The real check runs in CI's browser-checks job on this PR.

## Validation decision
No Mortals full validation: the change is one browser-check script, which nothing in the node or shell suites reads,
and CI's browser-checks job runs this exact check. The 0.7.44 re-cut then runs the whole suite and the page layer on
the tree that ships. Checked rather than assumed: no test names render-rename-say (the two hits for "render-rename"
are other checks, and pass 18/18), and the 61 test files that scan docs/browser-checks/ pass 1426/1426 with this change.
Weakest premise: that the CI browser-checks job's load is enough to show the check is green; it was green there before
too, so CI cannot show the crash is gone, only that the check still passes. The mechanism repro is what shows that.
