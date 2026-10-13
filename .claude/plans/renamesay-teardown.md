# renamesay-teardown: render-rename-say crashed after every assertion passed (aborted the 0.7.44 cut)

**Branch:** `renamesay-teardown` · Found by: the 0.7.44 staging cut, step 3b, 2026-10-12 23:36 CDT (frozen 46d024a49).

## The defect
render-rename-say passed all 12 assertions, twice, and then crashed: `TargetClosedError: route.fetch: Request context
disposed` at its `/api/status` route handler, so the check exited non-zero and the cut aborted. The handler was added by
#6010 (dupname-5957, mine): it fetches the real status poll and sets one flag. The page polls on a timer, so a poll can
be in flight when the check closes the browser; the handler's `r.fetch()` then rejects, unhandled, and Node exits 1.
It passed CI on #6010; under the cut's load (Mortals load 4.5) a poll was in flight at teardown both times.

## The fix
- The handler's body is in a try/catch that aborts the request (review 1: an empty catch would leave a failed poll
  hanging mid-check and fail on an unrelated assertion); `abort` is itself guarded, so after close it is quiet.
  The profile and instructions handlers await their answers with the same guard.
- Before `browser.close()`, `page.unrouteAll({ behavior: 'ignoreErrors' })`, the form Playwright's own error message
  recommends. Six other checks already use this exact form (measured: render-mobilenav-4823, render-engine-restart-4408,
  render-login-expiry-3532, render-teamcreate-4557, render-updates-stale, render-update-win32-manual);
  render-project-done-4583 unroutes with 'wait' instead.
No assertion changes. Trade-off, accepted: a real /api/status failure during the check is now aborted and shows only as
a network error in the page, where on main it crashed the check loudly. Every assertion still runs, and the ones after
the editor load need a status answer, so a real failure still turns the check red.

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

## Review 1 (opus, blind, on f601d2bc7): one warning, two nits; all taken
1. [WARNING] the empty catch left a failed poll hanging during the check. FIXED: abort, guarded.
2. [NIT] profile and instructions handlers did not await or guard fulfill. FIXED.
3. [NIT] "three other checks" undercounts. FIXED.
Also reported, NOT in this branch: 8 other checks have an unguarded fetch on a status route and no unrouteAll
(render-owncode-4649, render-swarm-ui-3564, render-connlost-reconnect-3410, render-start-agent-3410,
render-update-abort-2055, render-detail-header-1841, render-member-ring-3991, render-made-endings). Filed as #6022 (it
also aborted 0.7.42, #5921), so this fix stays the one the 0.7.44 re-cut needs.

## Review 2 (sonnet, blind, on 9d5920cd6): one warning (plan text), two nits
1. [WARNING] the plan said "at least seven" checks use unrouteAll with ignoreErrors; measured six (a seventh uses 'wait'). FIXED.
2. [NIT] the plan should say a real status failure is now quiet. FIXED (the trade-off paragraph).
3. [NIT] a failed `continue()` on a non-PUT profile or instructions request would hang until a timeout rather than pass
   wrongly. ACCEPTED: a continue fails only once the page is closing, and a hang still fails the check.
4. The card number for the 8 other checks: #6022. FIXED.
