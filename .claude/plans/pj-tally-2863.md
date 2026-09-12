# pj-tally-2863 — Projects unread "Messages" tally tile (#2863)

## What finished looks like
On the Projects board, when any project has unread messages, a "Messages" tile
appears in the projects statsrow showing the total across the active board; it
hides when the total is zero. This mirrors the agents "Messages" tile shipped in
#2888, completing the projects half of #2863's top tallies ("tally those at the
top... so you can see where notifications are happening and need you").

## Scope
The #2863 card asks for notification tallies "by agent and by project". The agents
tally (a.dmUnread rollup) shipped in #2888. This branch adds the **projects** tally
(p.unread rollup). Still open on #2863 after this: the list-view badge and the
org-node badge (separate placement work).

## Design decisions
- **What it sums:** `p.unread` across `active` projects (non-archived), matching
  what `st-pj` (the "Projects" count beside it) already scopes to. Sub-projects are
  their own rows in `active` (linked by `p.parent`), so a flat `active.reduce` over
  the array catches every visible per-card badge, parent and child alike.
- **Exclude the open project (PJ_CURRENT):** the per-card badge suppresses the open
  project's badge (`unreadBadge(p.id === PJ_CURRENT ? 0 : p.unread)`), and
  `ringNewMessages` excludes it from the ping. The tally excludes it too, so the tile
  agrees with the badges on the room you are reading (the projects poll can report
  unread=1 for that room before this tick's /seen lands).
- **null / negative → 0:** an unknown (null) or negative count contributes 0, never a
  guess — the same rule the ring and the agents tally keep.
- **Hidden at zero:** the same grammar as the "Needs you" tile beside it, so a quiet
  board is unchanged.
- **Failed read (pjTilesUnknown):** blanks the tile to `?`-and-hidden rather than
  leaving a stale count standing — the projects twin of the agents failed-poll reset.
- **Glyph:** its own muted message-bubble glyph (`.dmtile-g`, `--k-ink-2`), NOT the
  red `.haz` alert mark: unread messages point you somewhere, they are not a fault.
  Same choice as the agents tile.

## Files
- `web/index.html`: the tile markup in the projects statsrow (after `st-pjattn-tile`);
  the `pjDmTotal` reduce + tile-set in `paintProjects`; the failed-read reset in
  `pjTilesUnknown`.
- `web.pj-tally-2863.test.js`: extracts the real `pjDmTotal` reduce from source and
  evals it (sum, sub-project, PJ_CURRENT exclusion, null/negative), plus wiring and
  markup/glyph assertions. Modeled on `web.dm-tally-2863.test.js` (the agents twin).

## Verification
- `node --test web.pj-tally-2863.test.js` (6/6).
- Full suite via `bash tools/run-tests.sh` (green).
- Browser-check: not renderable from the design-bot session (no Playwright); the
  sum + wiring are pinned by the unit test and Josh reviews live in-app. Satisfied by
  a `Browser-check:` trailer on the code commit, the same treatment as the agents
  twin tile in #2888.

## Rejected alternatives
- **Summing all projects including archived:** rejected — `st-pj` counts active only,
  so the tally beside it must match, and an archived project's unread badge sits in a
  collapsed disclosure, not on the board. Counting it would show a total with no
  visible badge to explain it.
- **A second server-side derivation of the total:** rejected — summing client-side
  from the same `active` rows the cards render means the tile can never disagree with
  the badges, the same reason the agents tally sums client-side from `data.agents`.
