# streakidle-6188: render-allagents-4812 timed out on main since the streak (#6171)

## Done when
- render-allagents-4812 passes on this branch in both engines (it timed out on main: 29 pass, 1 fail).
- render-streak-6160 passes repeatedly on a fresh board.
- #6188 and #6187 (the same failure) are closed once this is on main.

## Cause (measured, not assumed)
A throwaway probe of the check's first page load logged the streak POST: the board answered 403 and the request was
still open 14.8 s later. The check serves the page at https://laptop.kosmosplus.com and proxies every request to the
board on loopback with its Origin unchanged, so the board's cross-site write guard (server.js, crossSiteWrite, before
every route) refuses the POST. The page then returned on `!r.ok` without reading the body, and an unread response
body keeps the request open, so `waitUntil: 'networkidle'` never came.

## Built
- web/index.html streakCheck: a refusal's body is read (`await r.text().catch(() => {})`) before returning.
- docs/browser-checks/render-streak-6160.js: answers /api/first-run as done before every page load, as
  render-allagents-4812 does. Its Escape only put the welcome overlay away when it was already open; when the
  overlay opened later it took focus from the dismiss arm.

## Measured
- render-allagents-4812: main 29 PASS / 1 FAIL (the goto timeout); this branch 58 PASS / 0 FAIL.
- render-streak-6160 on fresh sandbox boards, before the check change: main passed once and failed once, the branch
  failed twice (both: the dismiss arm, focus on fr-pane-5-h2). One branch run stopped at 28 passes, cause not kept.
  After it: 3 of 3 runs passed, 78 PASS each.
- server.streak-6160 and engine streak-6160 tests: 16/16.

## Calls
1. Fix in the page, not only the check: any refusal (a stale session, a guard) would hold a page's network open the
   same way. Rejected: fulfilling /api/streak in render-allagents-4812, which would hide this from the check.
2. The 403 itself is the check's proxy, not the product: the real Kosmos+ path reaches the board as its own origin.

## Weakest premise
That the real Kosmos+ path does not also refuse the streak POST. If it does, the streak never counts on a phone
reaching this computer through Kosmos+; this change makes that failure quiet instead of hanging, and it would be a
separate card.
