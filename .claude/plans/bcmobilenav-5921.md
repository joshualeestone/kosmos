# bcmobilenav-5921: render-mobilenav-4823 stops routing before each context closes (kosmos#5921)

Started 05:1x CDT 2026-10-12, after this check aborted the 0.7.42 staging cut (frozen 5621723a5; nothing served).

## What
A route handler still between r.fetch and r.fulfill when its context closes throws ("Fetch response has been
disposed", or "Request context disposed." if the fetch itself is in flight) from inside the handler, where nothing
catches it, and the whole check dies after its assertions passed. The disposal comes from the CONTEXT CLOSING
(Playwright clears stored fetch bodies on BrowserContext close), not from LO1's reload; the reload only starts a fresh
/api/status poll just before the close. Fix: every ctx.close() goes through shut(), which first calls
page.unrouteAll and ctx.unrouteAll with { behavior: 'ignoreErrors' }; and the finally that closes the browser
unroutes any context an arm left open (a failing arm never reaches its shut()), so a teardown crash cannot replace
the real error. The page is closed between the two unroutes, because on WebKit the context's route is what answers
remote.test and a page still polling without it would reach real DNS. Precedent: render-login-expiry-3532,
render-teamcreate-4557, render-engine-restart-4408, render-update-win32-manual and render-updates-stale call
page.unrouteAll with ignoreErrors at teardown (render-project-done-4583 uses 'wait', a different semantic). No other
check calls ctx.unrouteAll, so that is new here; render-allagents-4812, render-push-718 and mobile-shots do route on
the context and may carry the same teardown race (noted on #5921, not changed here).

## Decided
- The repo's established unrouteAll-before-close, not a per-handler message match (my first version, reviewed and
  replaced): it covers every handler still routed at teardown and every variant of the error, and applies only at
  teardown, so it cannot hide a routing error while assertions are running. Two stubs taken off earlier with a plain
  page.unroute (lines near the O1 and LO1 arms) are outside it; both fulfil at once with no fetch.
- Rejected: retrying the check more times in browser-checks.sh (hides a race behind a retry count).
- Weakest premise: ignoreErrors at teardown also swallows a real handler bug that only shows during close. Nothing
  is asserted after close, so no assertion can depend on it.

## Measured
- Before: alone on Mortals at 5621723a5, 3 runs, 1 crashed (169 pass, then disposed); in the cut, 2 of 2 crashed.
- After: alone on Mortals at origin/main, 20 of 20 clean with the unroute approach (171 pass, 0 fail, 0 disposed):
  8 before the finally change, 4 with it, 4 with the page closed between the unroutes, 4 on this final file.
- At the before-rate (1 in 3), 20 clean runs happen by chance about 0.03% of the time. Evidence, not proof.
- The fix rests on Playwright's documented ignoreErrors semantics, not on a reproduced failure.
- NOT measured: a deterministic red arm. Two injections were tried, applied identically to the old and new files:
  - a pause of 400 ms before the status fulfil: both passed (not discriminating)
  - a slowed status poll fired just before the first close: both passed (not discriminating)
  A 5 s pause broke page load for both. So whether the old file crashes under a forced close was not reproduced.
- No full suite: one browser-check file, which the node and shell suites do not run. PR CI runs them; the next cut
  runs this check again.
