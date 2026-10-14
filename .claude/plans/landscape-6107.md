# #6107 tablets as a first-class design: the landscape slice (split view)

Owner: Angel. Started 2026-10-14 03:45 CDT. Builds on the portrait slice (PR #6135, merged).
Not merged before Josh answers "split view or card grid" for landscape, or noon CDT 10-14 (my default: split view).

## Finished looks like
On a touch tablet held sideways (960px and up), the Agents and Projects tabs open on the one-screen
(consolidated) layout: agents with names and their latest state on the left, projects beside them, the open
agent or project on the right. The agents rail is open, not folded to faces, at 1100px and up (every
landscape iPad). The layout choice on such a tablet is that tablet's own: the header toggle there never
changes the board's setting, so the Mac keeps whatever it has. Phones, upright tablets, laptops and desktops
behave exactly as before.

## What changes
- web/index.html: TABLET_LAYOUT_MQ, deviceLayout(), STYLE_LAYOUT (the board's layout setting as last read),
  the header toggle's tablet branch (local only), a change listener for turning the tablet;
  CONSOLIDATED_TABLET_OPEN_MQ so railFoldsApply leaves the agents rail open at 1100px and up on a landscape
  touch tablet (a stored per-session fold still wins).
- docs/browser-checks/mobile-shots.js: tablets 960px and up shoot desktop-only (one-screen) screens.
- web.layout-picker.test.js, web.consolidated-breakpoint.test.js: pinned.

## Decided
- Per-device layout on landscape tablets (card comment 6166871307): the board has ONE layout setting for every
  screen, so "unless the person picked one" cannot be read from it. Rejected: the tablet writing the board
  setting (flips the Mac too); a board-level tablet field (same problem one level down).
- Rail open from 1100px: measured, all three columns fit at the iPad mini's 1133px (shots 05:5x).
- Weakest premise: that people expect a tablet to remember its own layout rather than share the Mac's.
- Known limit (review round 1): the rule keys on (hover: none) and (pointer: coarse). An iPad docked in a
  keyboard with a trackpad may report a hover-capable or fine pointer, in which case it drops out of the rule:
  it gets the board's layout and its toggle writes the board again (flipping the Mac). Not measurable here (no
  iPad); to confirm on Josh's tablet. If it drops out, the next step is keying the per-device choice on the
  device rather than the pointer.

- Known limit (review round 3): the page reads the board's layout once, at load. A tablet left open sideways
  while the Mac changes the board, then turned upright, applies the layout from load until the next reload.
  This was already true of every screen before this change.
- Measured (2026-10-13, Playwright 1.x): WebKit with hasTouch reports (hover: none) and (pointer: coarse) like
  Chromium, so the WebKit tablet shots do exercise the rule.
## Done when
Shots at ipadminiland and ipad11land show the one-screen view by default with the rail open; a browser check
pins the default, the per-device toggle (board setting unchanged) and the controls (turned upright, a mouse at
the same size, the rail folding under 1100px; a phone needs none, the view is not offered under 960px); CI green; Josh has answered or noon has passed.

