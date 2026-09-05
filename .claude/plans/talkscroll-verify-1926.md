# talkscroll-verify-1926: hermetic verification of the talk-thread scroll-anchor

## Card
kosmos#1926: "The conversation view flashes and jumps every 5 seconds, but only when the reader
has scrolled back." Josh-reported, recurring. The fix (Angel's PR #1931) is MERGED: `setThread`
anchors a scrolled-back reader to the MESSAGE they were on (`threadAnchor` / `restoreThreadAnchor`),
not a pixel, so content that changes height ABOVE the reader between the 5s polls does not slide
them onto a different message.

## Why this is not a product change
The fix is already on main. This card was parked `needs-browser` because it had **no automated
verification**: `web.thread-scroll.test.js` drives `setThread` against a stub box whose
`querySelectorAll` returns `[]`, so `threadAnchor` returns null and only the #1037 pixel-fallback
is exercised, never the #1926 message-anchor. And the belief that a bot session cannot run
Playwright at night (why Angel parked it) is disproven by the pinned `~/work/pw-runtime` runtime
(Splinter's capability heads-up; I used it for #2095's browser-check).

## Decision (design owner, Mona Lisa)
Add a hermetic browser-check that fills the exact gap, rather than change any product code.

## What was added
- `docs/browser-checks/render-talk-anchor-1926.js`: loads `web/index.html` (file://, no board),
  unhides the detail panel's ancestors + makes `#d-dmthread` a fixed-height scroll box, drives the
  REAL `setThread`/`threadAnchor`/`restoreThreadAnchor` against 40 real `data-mid` rows, scrolls a
  middle message (m20) to ~40px below the viewport top (scrolled back, not at bottom), then repaints
  with the 15 rows ABOVE the reader made taller. Asserts m20's offset below the viewport top is
  preserved (40px -> 40px). **Control:** computes where a pixel-restore would have left m20 (644px)
  and asserts that would have jumped (>20px), so the above-content genuinely grew and the pass is
  meaningful. Also asserts `dmRow` stamps the stable `data-mid` the anchor reads. Headless PASS.
- Wired into `tools/browser-checks.sh`'s no-URL render loop (#1387).
- `EXPECTED_SITES` 42->43, `EXPECTED_CATCH_SITES` 24->25 (#1864): the check adds one SHAPE-1
  finding-emit loop + one launch-catch, same shape as render-account-name-2095.
- README row (#612).

## Red-capable
The assertion `abs(afterDelta - beforeDelta) <= 3` compares the anchored result (40px) against the
captured before-offset. If the fix were absent (pixel-restore), `afterDelta` would be the pixel
result (644px) and the assertion would fail by 604px. The control arm proves the scenario moves
content, so a green cannot come from a scenario that never jumped.

## Scope / what this does NOT do
- No product code changed (`web/index.html`, engine untouched), so the #1720 web-gate does not apply.
- Verifies the JUMP (the message-anchor). The pure visual FLICKER of an innerHTML repaint is not
  hermetically assertable; the disruptive part Josh reported (jumping to a different spot / the top)
  is what the anchor fixes and what this verifies. The card moves from `needs-browser` (no automated
  gate possible) to `ready-to-test` (mechanism verified; a subjective on-screen confirm on the next
  served build is the only remaining step, which is a tester/Josh action, not a browser-automation gap).

## Weakest premise
The check drives `setThread` directly with hand-built `data-mid` rows rather than through the full
`loadThread` fetch path, so it does not prove `loadThread` calls `setThread` with the right html on
the 5s poll. That wiring is exercised by the app itself and by `web.thread-scroll.test.js`'s own
call-site coverage; this check targets the anchor arithmetic + layout that nothing else covered.
