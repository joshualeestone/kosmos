# fetchcatch-6725: a request a reload cuts off is not a page error

Card: kosmos#6725. Blocks #6655 (its browser-checks red).

## Why
render-shell-noscroll-4872's WebKit "no page errors" arm flakes in CI. Of the 60 latest browser-checks runs, 7 ran
the arm and 5 of those show a failing attempt, two of them on branches unrelated to #6655. The errors are the board's
polls cut off by the check's own reloads. MEASURED (a diagnostic run of the new check, WebKit, failing on run 4 of 4)
that these are TWO different things:
- "Load failed": a real unhandled REJECTION from page code (a fetch with no catch), seen by `unhandledrejection`.
- "Fetch API cannot load <url> due to access control checks.": NOT a rejection; no `unhandledrejection` fired for any
  of them. It is WebKit's own message for a request the navigation cancelled, which Playwright passes on as a page
  error. No page code can suppress it.
Chromium reports neither, so only the WebKit arm sees them.

## What changes
- web/index.html, first in the main script: while the page is leaving, an unhandled TypeError rejection is ignored
  (`PAGE_LEAVING`, set at beforeunload, cleared after a second).
- docs/browser-checks/render-shell-noscroll-4872.js and the new check: a WebKit "due to access control checks" page
  error is not counted when it names THIS board's own address (host:port and the slash) AND arrives while a reload the
  check started is in flight (`cutOffByReload`, a `reloading` flag set only until the new page COMMITS: review 1 found a
  window to networkidle would also hide a real network failure while the new page loads).
- docs/browser-checks/render-leaving-rejection-6725.js: a request held open across a reload is no page error; CONTROL:
  a real rejection while not leaving still is; the predicate's own arms (another origin, a lookalike port, any other
  message: not matched). The lookalike-port arm caught a substring bug in the first version of the predicate.

## Decided
- One page-level rule instead of a catch at each caller: there are fifteen fetch sites on just the four routes in the
  logs, and any future caller would bring the flake back. For REJECTIONS the page rule is the right place: they are
  the page's own uncaught errors, in the Mac app's WebKit view too, not only in a check.
- beforeunload, not pagehide. MEASURED (scratch experiment, WebKit, 3 runs each): with pagehide alone the cut-off
  request still raised the error every time, because WebKit rejects BEFORE pagehide. With beforeunload it did not.
- The one-second reset: a navigation can start and never happen (a download link fires beforeunload and stays). MEASURED:
  a real rejection 1.5 s after a beforeunload that led nowhere was still reported, 3 of 3.
- The check filter is scoped three ways (message, own origin, during a reload) so a real cross-origin failure, or one
  at any other moment, still fails the arm. A filter on the message alone was rejected for that reason.

## Weakest premise
That Playwright delivers WebKit's cancelled-request page errors BEFORE page.reload resolves, so they land while the
`reloading` flag is set (the diagnostic saw all of them between beforeunload and pagehide, so before the new load). If
one arrives after, it still counts and the arm can still flake, never the other way round.
Third (review 4): that the new check is not itself a flake, which would block #6655 again. MEASURED: the WebKit
precondition held (rejections=1) in all 30 runs. One of those 30 runs, taken while two other suites loaded the
machine, failed an arm the run did not record; the next 15 runs had no failure. The one timing-sensitive arm (4, the
one-second reset) was then moved onto the page's own timers (100 ms, the reset at 1000 ms, 1600 ms), which may run late
but never out of order, so it no longer depends on how fast the check talks to the browser.
Second: that every page error in the flaky arm is a cut-off request. If a failing attempt shows an error that is not, this
fixes nothing for it. What would change my mind: such an error in a CI log after this merges.

## What is measured and what is not
- MEASURED: the access-control page errors are not rejections (diagnostic); the page rule suppresses "Load failed"
  during unload and still reports a real rejection, also after a navigation that never happened (3 of 3 each); the
  filter's predicate (own origin with the slash, not another origin, not a lookalike port, not another message).
- NOT measured: the filter firing inside a real reload. In 14 local passing runs it took nothing (`ignored=0`); the
  WebKit message came once in about 17 local runs and could not be produced on demand (a request held open at the
  route, or on the network before or after its headers, caught or not, never produced it). Both checks print
  `ignored=N`, so the first CI runs show whether the filter is what keeps the arm green.

Review 1 also made arm 1 able to fail: on WebKit it asserts the leaving page saw at least one rejection (counted in
sessionStorage by an init script), and arm 3 pins that the flaky check's copy of the predicate is the same line.

## Not covered
- The filter's window runs 250 ms past the new page's commit (review 2: a page error may arrive just after it), so a
  real own-origin "access control checks" failure in those first 250 ms of the new page is not counted. So is a real
  own-origin CORS or redirect regression that happens during the reload itself.
- The beforeunload listener may make the page ineligible for the back-forward cache in some browsers. The board is an
  app opened in its own window, not navigated back to, so this costs nothing measurable here.
A real TypeError rejection in the one second after beforeunload is hidden too. It is on a page that is going away.
