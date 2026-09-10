# Plan: browser-check for the #2628 world-switch abandon message (kosmos#2633)

Branch: `worldsw-abandon-check-2633`

## Goal

Add the missing browser-check for the #2628 UI branch. #2628 (branch
`worlds-abandon-visible-2628`, PR #2635, merged) surfaced a silent world-switch
abandon: when a switch reports `restarting:true` but the board comes back on
Kosmos 1 having abandoned the world you asked for, `worldswReconnect` now reads
`/api/status.lastAbandonedWorld` and says so at once instead of polling a bare
"Switching..." for the whole ceiling. The engine signal is unit-tested
(`engine/worldenv.abandon-2628.test.js`); the UI branch shipped under a
`Browser-check:` trailer with no browser check. This card fills that gap.

## Scope

- NEW `docs/browser-checks/render-worldsw-abandon-2628.js` (hermetic file://,
  board stubbed, reusing the #6 switch flow: open switcher -> row click ->
  confirm modal -> "Restart Kosmos").
- Register it in `tools/browser-checks.sh` (the no-server file:// loop).
- Document it in `docs/browser-checks/README.md`.
- Bump the two exact-count tripwires in `browser-checks-reason-grep.test.js`
  (+1 finding-emit -> 81, +1 catch/launch -> 50) with trail comments.
- NO change to `web/index.html` (the product code already shipped in #2628).

## The two scenarios

- **A (FRESH abandon):** POST `restarting:true` for w2, board back on w1 (never
  the switched-to w2), `lastAbandonedWorld = {id:w2, at AFTER the switch}`. The
  banner names the world ("Side Project" could not start...), the switcher menu
  (which holds the banner) stays open, the banner region is unhidden, and
  `worldswReload` is never called.
- **B (STALE abandon -- the `at > switchStart` guard):** `lastAbandonedWorld.at`
  older than the switch start (an earlier boot's abandon). The abandon banner
  must NOT fire; the reconnect falls through to the normal slow ("taking longer
  than usual") then timeout guidance, still no reload.

## Control / red-capability

Disabling the #2628 abandon branch in `worldswReconnect` reds scenario A (the
banner stays "Switching..."); scenario B stays green (it must, being the
negative arm). Both directions of the `at > switchStart` guard are exercised.

## Decisions

- **New file rather than folding scenarios into `render-worldswitch-2238.js`**
  (Angel's active #1704/#2238 switcher-harness lane). The card asks to coordinate
  so it slots in "rather than duplicating its stub"; a separate file with a
  minimal abandon-specific stub avoids colliding with her live 0.6.54 branches and
  does not grow her stateful reboot-poll machinery for a different signal
  (`lastAbandonedWorld`). Weakest premise: that Angel prefers a separate file;
  it moves cheaply into 2238.js if she would rather. Recorded on the card.

## Not doing

- No `web/index.html` change (would trip the #1720/#2518/emit-count web-change
  gates and is unnecessary -- the product code is already merged).
- Rides the 0.6.54 cut.
