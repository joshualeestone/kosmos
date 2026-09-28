# render-unread-edge-3743.js asserts the unread edge stays off (#4418), and is wired again

Branch unread-edge-off-3743, off origin/main a0fe9edd7. Angel, 2026-09-28, Mona's item 1 routed by Splinter.

## Finished looks like
docs/browser-checks/render-unread-edge-3743.js passes on main with the gold unread edge switched off
(UNREAD_EDGE_ON false since #4418), asserts that no unread agent message is marked or outlined in a DM, a
room and the setup guide, keeps its coverage for when the edge comes back, and runs again (gated.txt, not in
NOT_WIRED).

## Measured first
Pure origin/main: 11 arms failed (the MARKING arms: U1 x3, U1b, U2, U3, U4, U6, U8, U12, U13), then U11 threw
(it reads bookkeeping that never starts while off), so U6b and U15 (the guide) never ran. The DRAWING arms
(data-unread set by hand: U17, U17b-d, U18, U18b, U19, U2 fade, U5, U5b, U14) passed: the style is still there.

## Change
- The check reads the page's own UNREAD_EDGE_ON. Each marking arm goes through edgeChk: switched on, it asserts
  exactly as written; switched off, after driving the same scenario it asserts that every bubble where it
  looked (DM, room or guide) has no data-unread and a computed filter of none, and that it found at least one
  bubble (never a vacuous pass).
- Drawing arms unchanged (they cover the style for when the switch comes back). While off, the markers they
  set by hand are cleared once they finish, because the switched-off page never reads them away.
- U11 tolerates the bookkeeping not existing while off.
- gated.txt gains the check (sorted); NOT_WIRED loses it; the README row says how it works now.

## Decided
- Branch on the page's switch rather than rewriting the arms to off-only: Mona asked to keep the coverage, and
  the switch is meant to come back; the on-branch is the original assertions verbatim.
- web.unread-edge-off-4418.test.js (unit level) is unchanged.

## Weakest premise
That the on-branch still passes: the arms are verbatim, but only a run with the switch on proves it (a
perturbation below).
