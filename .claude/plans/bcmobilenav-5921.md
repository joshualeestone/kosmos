# bcmobilenav-5921: render-mobilenav-4823 survives a fetch the page abandoned (kosmos#5921)

Started 05:22 CDT 2026-10-12, after this check aborted the 0.7.42 staging cut (frozen 5621723a5; nothing
published).

## What
Two route handlers fetch from the board and then fulfil: the WebKit remote.test router and the /api/status rewriter.
When the page reloads (LO1's Log out), a request in flight is abandoned, and r.fulfill throws "Fetch response has
been disposed" inside the handler. Nothing catches it there, so node dies with an uncaught exception. A shared
`abandoned(e)` swallows only "has been disposed" or "has been closed"; anything else still throws. The fulfils are
awaited inside the try, so their rejection is caught there and is never left floating.

## Decided
- Swallow, do not retry: an abandoned request has no page waiting for it. The LO1 assertions still check what the
  person sees (one Log out post, then signed out at the start).
- Rejected: retrying the check more times in browser-checks.sh. That hides a real race behind a retry count.
- Weakest premise: a disposed or closed error raised for some other reason would now be silent. The check's own
  assertions on each page would still fail if a needed response never arrived.

## Measured
- Before: alone on Mortals at 5621723a5, 3 runs: 1 crashed (169 pass, then disposed), 2 passed (171). In the cut: 2 of 2.
- After: alone on Mortals at origin/main with this file, 6 runs: 6 passed (171 pass, 0 fail, 0 disposed), load about 5.
  At the before-rate (1 in 3), six clean runs happen by chance about 9% of the time, so this is evidence, not proof.
- No full suite: the change is one browser-check file, which the node and shell suites do not run. PR CI runs the
  suites, and the next cut runs this check again.
