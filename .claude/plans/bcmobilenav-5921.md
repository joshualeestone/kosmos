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
  page.unroute (one in the C0 Switch Computers arm, one in LO1) are outside it; both fulfil at once with no fetch.
  The 1500 ms computers stub that replaces the first one stays routed, so unrouteAll covers it.
- Rejected: retrying the check more times in browser-checks.sh (hides a race behind a retry count).
- The WebKit context route is self-contained: it catches its own failure and aborts that request. Reviews 3 and 5
  flipped the teardown ORDER (page close first keeps a still-polling page off real DNS; page close first also leaves
  the context handler exposed to a target-closed rejection before its ignoreErrors). Two rounds rewriting one rule
  means it lived in the wrong place, so the handler now owns its failure and the order matters only for DNS.
- Nothing passes silently: an abort while the page is open (abortedLive) and a failed ctx.close or browser.close
  (teardownFails, page.close included) are counted and checked at the end, so they fail an otherwise green run without replacing an arm's
  own error. A context leaves `live` before its teardown starts, so a teardown abort is never counted as one while open.
- Weakest premise: ignoreErrors at teardown also swallows a real handler bug that only shows during close.

## Measured
- Before: alone on Mortals at 5621723a5, 3 runs, 1 crashed (169 pass, then disposed); in the cut, 2 of 2 crashed.
- After: alone on Mortals at origin/main, 40 of 40 runs of the unroute approach clean (0 fail, 0 disposed), across
  nine successive versions of the file, 4 or 8 runs each (171 checks before the end counts were added, 173 after).
  Only the last 4 ran this exact file.
- At the before-rate (1 in 3), 40 clean runs of the approach happen by chance about 1 in 11 million; that is about the
  OLD crash, not about this exact file or any residual window.
- The fix rests on Playwright's documented ignoreErrors semantics, not on a reproduced failure.
- NOT measured: a deterministic red arm. Two injections were tried, applied identically to the old and new files:
  - a pause of 400 ms before the status fulfil: both passed (not discriminating)
  - a slowed status poll fired just before the first close: both passed (not discriminating)
  A 5 s pause broke page load for both. So whether the old file crashes under a forced close was not reproduced.
- No full suite: one browser-check file, which the node and shell suites do not run. PR CI runs them; the next cut
  runs this check again.
- Red arm for the new abort count (this IS measured): a mutant that throws on the WebKit proxy's first non-document
  request fails exactly "no proxied remote.test request failed while its page was open" (172 pass, 1 fail). Aimed at
  the first request of any kind it hit the document load and crashed page.goto instead; aimed at /api/status it never
  fired (the page-level handler serves those first). Both recorded, neither counted.
