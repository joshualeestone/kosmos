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

## Done when
Shots at ipadminiland and ipad11land show the one-screen view by default with the rail open; a browser check
pins the default, the per-device toggle (board setting unchanged) and the controls (upright tablet, mouse,
phone unchanged); CI green; Josh has answered or noon has passed.
