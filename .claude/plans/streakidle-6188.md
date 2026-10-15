# streakidle-6188: render-allagents-4812 timed out on main since the streak (#6171)

## Done when
- render-allagents-4812 passes on this branch in both engines (it timed out on main: 29 pass, 1 fail).
- render-streak-6160 passes on fresh boards in every run measured (see Measured for the count).
- #6188 and #6187 (the same failure) are closed once this is on main.

## Cause (measured, not assumed)
A throwaway probe of the check's first page load logged the streak POST: the board answered 403 and the request was
still open 14.8 s later. The check serves the page at https://laptop.kosmosplus.com and proxies every request to the
board on loopback with its Origin unchanged, so the board's cross-site write guard (server.js, crossSiteWrite, before
every route) refuses the POST. The page then returned on `!r.ok` without reading the body, and an unread response
body keeps the request open, so `waitUntil: 'networkidle'` never came.

## Built
- web/index.html streakCheck: a refusal's body is read (`r.text().catch(() => {})`, not awaited, so a slow body cannot
  keep `streakAsking` set) before returning.
- docs/browser-checks/render-streak-6160.js: answers /api/first-run as done before every page load, as
  render-allagents-4812 does. Its Escape only put the welcome overlay away when it was already open; when the
  overlay opened later it took focus from the dismiss arm.
- firstRunBoot (also on the load path) reads a refusal's body the same way before giving up.
- render-streak-6160's refused arm now gets its 403 from the board itself, through route.fetch with another site's
  Origin (the same proxy shape as the original failure), and asserts every refused request finished. A refusal made
  up by route.fulfill arrives whole and finished either way, so it could not show the defect (measured: that version
  of the assertion passed with the fix reverted).

## Measured
- render-allagents-4812: main 29 PASS / 1 FAIL (the goto timeout); this branch 58 PASS / 0 FAIL.
- render-streak-6160 on fresh sandbox boards, before the check change: main passed once and failed once, the branch
  failed twice (both: the dismiss arm, focus on fr-pane-5-h2). One branch run stopped at 28 passes, cause not kept.
  After it: 3 of 3 runs passed, 78 PASS each.
- The refused arm with the board's own 403: 80 PASS with the fix; with the page fix reverted it fails
  (sent=5 finished=0).
- After iteration 2 (helper, deterministic wait, non-awaited drain): 3 of 3 runs 80 PASS; the control with the page fix
  reverted fails the same line (sent=5 finished=0). The early 28-pass stop seen once before the check change was not
  seen again in 8 later runs; its log was not kept, so its cause is unknown.
- After iteration 3 (the first-run arm): fix 82 PASS; with firstRunBoot's body read reverted, the first-run arm fails
  (sent=1 finished=0); with streakCheck's reverted, the refused arm fails (sent=5 finished=0). Each guard was shown red
  on its own site.
- After iteration 5 (the refused arm steps the clock a minute at a time and lets each refusal settle): 2 of 2 runs
  82 PASS.
- server.streak-6160 and engine streak-6160 tests: 16/16.

## The class (measured, filed separately)
A probe loading the page against a fresh board with every /api/ GET answered by the board's own 404 left 19 requests
open after 20 s (worlds/names, remote/computers, engmode, autoupdate, the settings reads, community, you, whats-new,
removed, register, roles, phone-notify). Without the refusals, one (community/ready) was open. A direct refusal from
the real board with no proxy also never finishes while its body is unread (3 sent, 0 finished). So any load-time
refusal holds the page's network open; it predates the streak. This card fixes the two sites it touches; the class is
its own card, #6192.

## Guards
- The streak site: render-streak-6160's refused arm (the board's own 403), proven red with the page fix reverted.
- The first-run site: a refused-first-run arm (the board's own 404 passed through as /api/first-run's answer), asserting
  the read finishes.
- render-allagents-4812 itself is in docs/browser-checks/gated.txt (line 26), so the runner's gated loop runs it.

## First run and the dismiss arm
render-streak-6160 now answers /api/first-run as done in every arm. The overlay and the congrats note do not meet on a
real board: first run is day 1, and day 1 shows no note (that arm is in the check). So the check no longer covers an
interaction that cannot happen.

## Calls
1. Fix in the page, not only the check: any refusal (a stale session, a guard) would hold a page's network open the
   same way. Rejected: fulfilling /api/streak in render-allagents-4812, which would hide this from the check.
2. The 403 itself is the check's proxy, not the product: the real Kosmos+ path reaches the board as its own origin.

## Weakest premise
That the real Kosmos+ path does not also refuse the streak POST. If it does, the streak never counts on a phone
reaching this computer through Kosmos+; this change makes that failure quiet instead of hanging, and it would be a
separate card: filed as #6194 (not measured).
