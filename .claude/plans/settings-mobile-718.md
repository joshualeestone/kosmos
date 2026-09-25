# settings-mobile-718: Settings fits a phone

Addresses #718 (Josh, 2026-09-24: "make sure the designs fit well on mobile"). Sonya owns the
`settings` and `settings-accounts` screens in Raiden's shared harness (`mobile-shots.js`).

## Finished means
On a 375 to 430px wide phone, in light and dark, Settings shows its section pills as one row
that scrolls sideways inside itself (the page never scrolls sideways), the chosen pill is in
view, text fields do not trigger the iOS focus zoom, and every control is at least 44px to tap.
A browser check fails if any of that regresses.

## Measured before (origin/main ef58032d, 375x667)
- 11 pills wrapped into 6 rows; header plus pills filled about 70% of the first screen.
- Fields 13px (iOS Safari zooms the page on focus below 16px).
- Pills 34px tall; most controls 20 to 35px against a 44px target.

## Change (web/index.html only)
- One `@media (max-width: 40rem)` block scoped to `#panel-settings` / `#s-nav`, so the agent
  nav (`#d-nav`) and shared tokens are untouched. Nav is `nowrap` + `overflow-x: auto` with a
  right-edge fade; pills 44px; fields 16px; `.dsec` controls 44px min-height; a switch keeps its
  drawn 42x24 and gets an invisible 44px hit area via `::after`; account actions drop dividers
  so a wrapped line does not start with one.
- `settingsGo` centres the current pill with `scrollLeft` when the nav overflows.

## Rejected
- A select dropdown instead of pills: hides the section list, and the pills are how the desktop
  reads. A one-row scroller keeps the same control.
- Enlarging the switch itself: breaks its drawn proportions against the other switches.

## Check
`docs/browser-checks/render-settings-nav.js` gains a 375x667 block (both themes). Proven both
ways: all pass on this branch; on ef58032d 12 fail (6 rows, 13px, 34px, switch hit area false),
including the off-edge control.

## Weakest part
WebKit in Playwright is not iOS Safari; the 16px zoom rule and the mask fade are unverified on a
real iPhone. The 44px rule is applied to `.dsec` controls broadly, so a section added later gets
it too; that is intended, but a dense future section may look taller than its designer expected.

## Resumed 2026-09-25 (after the Inmar demo), rebased on origin/main 164df8ed7
- The parked WIP adds: centred snap, 28px end padding on a pill carrying the needs-you dot, a
  vertically centred Kosmos Plus sign-in pill, and 4px nav padding so focus rings are not clipped.
- Two of its checks measured the wrong thing and are fixed. The dot check measured the whole
  button, which includes the visually hidden "(needs you)" span; it now measures the visible
  label. The switch check used eng-toggle, which ships `hidden` and sat in a section not on
  screen; it now uses tips-toggle, with its section (Computer) opened first.
- Proven both ways: 116/116 pass on this branch; the same check on origin/main fails 18. Removing
  only the dot padding rule fails the dot check (dot 1px over the label), so that rule is needed.
- Before/after shots, 4 sizes x 2 themes (375x667, 393x852, 412x915, 430x932): pills 5-6 rows
  before, 1 row after, no page overflow in any. Kept in Sonya's evidence/settings-718.
- Centring moved into `centreSettingsPill()`, also run by `showTab('settings')` and when the
  window crosses into the phone width: a section chosen while Settings was hidden, or at desktop
  width, was never centred. Two checks cover it and fail with the two hooks removed. Their first
  version passed with the hooks removed too, because Chrome's scroll-snap restores the pill it
  last snapped to; each now uses a pill nothing at phone width clicked before it.
- The 44px rule on `.dsec` buttons was measured over all 11 sections at 375px: every visible
  button is block-level (none sit inside a sentence), and the dense lists (Global Skills,
  Connections) read cleanly. Deferred as not an issue.
