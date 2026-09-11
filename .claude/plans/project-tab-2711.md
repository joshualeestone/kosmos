# Project page (tab view) styling pass, #2711, copy batch

Card #2711 is Josh's 17-item cohesive styling/UX pass for the project page
(tab view). It is being delivered as focused batches (Josh allowed "bunches").
This branch (`project-tab-2711`) is the copy / labels batch, the low-risk,
structural, string-level items. The heavier visual and interactive items
(header declutter, dialog white/strokes, hover-emoji picker, member colour
states, search expand, dialog always-visible) follow on their own branches.

## What this branch does

- Item 14: members card heading "Project members" becomes "Members".
- Item 13: files card heading "Files in this project" becomes "Files".
- Item 9: remove the composer hint line under the input ("Drop a file
  anywhere... Type @ and a name...") from both views. It named a drop-to-attach
  behaviour that is not built and the @ mechanism; the @ picker still opens on
  typing @, so the affordance survives. Removed the now-moot consolidated-only
  `display:none` rule for it, and the two dead `.composerhint` base CSS rules.
- Item 12: the Files and Tasks "View All" doors both read "View All"
  (capital V and A, Josh's exact words; the files door already did via JS, the
  tasks door said "View all tasks" with an arrow). New `.pj-viewall` class
  centres them and drops the `.linkish` underline for these two doors only.
- Item 11: already satisfied on main (`.tkcards` is a flex column with
  `min-height:14rem` and `.tk-empty` has `margin:auto 0`, so the empty text
  centres). No change; Josh's shipped build lags main. Recorded for the card.

## Tests / checks updated in lockstep

- `server.test.js` members presence-control keys on the new `>Members</h3>`.
- `web.consolidated-match-mock.test.js` asserts the composer hint is gone from
  both views (was: "stripped in consolidated only"), with a presence control.
- `web.mention-picker.test.js` / `web.links-everywhere.test.js` drop the
  removed hint-sentence assertions (the picker/listbox assertions stay).
- `web.consolidated-project-name-overflow.test.js` comment de-references the
  removed rule.
- `web.alltasks-1382.test.js` / `web.tasks-column-1009.test.js` /
  `web.tasks-cap-1193.test.js`: tasks-door label + no-count guards + controls
  now key on "View All".
- `docs/browser-checks/render-projects.js`: the two card-heading `expect`s and
  the members-heading throw-guard updated to "Members" / "Files".
- `docs/browser-checks/render-alltasks.js`: asserts the door reads "View All"
  (satisfies the #2518 surface gate for the pj-alltasks change).

## Not in this branch (follow-on batches)

Items 1 (remove strokes), 2 (remove description triangle), 3 (cog left of
title), 4 (search expand-on-focus), 5 (remove header rule), 6 (dialog white),
7 (dialog always fully visible), 8 (hover highlight + click emoji picker),
10 (small add-buttons top-right), 15 (agent file-post grey), 16 (member 3-state
colours + remove status lines/stroke), 17 (remove back arrow). Several are
theme-sensitive or entangled with the dual-layout system and want Josh's visual
review in the running app; they are being built with care on their own branches.

## Scope / ownership

Design + content pass on the project page, Mona Lisa's lane. Josh assigned it
directly in `#chaoskosmos-design`. No engine/CLI/server changes. Collision
check clear (only win32 PRs open; Angel is on #2702, room/CLI). Heads-up sent to
Angel before taking the web/index.html project-page region.
