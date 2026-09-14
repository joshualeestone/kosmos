# #2850 - Consolidated view redesign: rail-head control swap (PR 1)

## Card
#2850 (Josh, 0.6.57 live review, 2026-09-11): "Consolidated view - design changes
(running list)". This branch delivers PART of one item of the multi-item card - the rail-head
control swap (item 4), for the AGENTS and PROJECTS rails only - as a coherent, mergeable slice.
Item 4 also names tasks and members; their + currently sits LEFT (kosmos#1303 H, to match the
OLD agents/projects arrangement) via a fiddly multi-variant grid (.pjsplit / .pj3), so
repositioning them is deferred to a render-capable pass rather than changed blind. That leaves a
temporary state where tasks/members + are on the left while agents/projects + are on the right;
it is tracked on #2850. The rest of the card's items follow in later passes (see the card and my
daily report for the ordered list).

## What finished looks like
In the consolidated view, the agents rail and the projects rail each show the collapse
(fold) arrow on the LEFT of their header (beside the section name) and the "+" (New agent /
New project) on the FAR RIGHT. This matches the tab-view grammar and lines the collapse
control up flush-left with the content below. The change is markup-only; all element ids
are unchanged.

## Approach
- `web/index.html`: in the `#rail-agents` and `#rail-projects` railheads, move the
  `id="rail-*-fold"` button into `.lead` (before `.railname`) and move the
  `id="rail-*-new"` (`+`) button out into `.railacts`. Update the stale 2026-08-27 comment
  that documented the now-reversed arrangement.
- `web.layout-picker.test.js`: update the locking asserts (which pinned the old
  +-in-`.lead` markup) to assert the new order (fold-in-`.lead`, +-in-`.railacts`), so a
  regression back to the old arrangement is caught. Leave the K-mark guard intact.

## Why this is safe / decisions
- REVERSES Josh's own 2026-08-27 decision (documented in code + test). Newest ruling wins;
  his 0.6.57 spec is explicit. Weakest premise: I read "match the tab view" as the looser
  intent (make the headers feel like the tab-view section headers) rather than a literal
  "+ goes exactly where the tab view puts it" - the concrete instruction (collapse left, +
  far right) is unambiguous and is what I implemented.
- Ids unchanged => the fold/new click handlers and `docs/browser-checks/render-consolidated-layouts.js`
  (which clicks these buttons by id) are unaffected.
- Folded-state CSS (`.fold-a` / `.fold-p`) still works: the fold arrow (now in `.lead`)
  shows when folded; the `+` is hidden when folded via the existing
  `#rail-*-new { display:none }` rule (unchanged).

## Out of scope for this PR (deferred, documented on the card)
- Item 4 REMAINDER (tasks + members + reposition to the right): fiddly multi-variant grid
  (kosmos#1303 H, .pjsplit / .pj3), needs a live render to verify; deferred rather than done blind.
- Item 6 (dialog bubbles + emoji picker/pop-out): covered by in-flight #2805/#2806/#2834.
- Items 2/3 (baseline tuning), 12 (avatar flush-left): pixel work that needs a live render.
- Item 5 (remove close-projects-tab), 7 (cog/desc-arrow, dup #2838), 9/10/11 (agent-row
  state colors), 8 (subprojects list, #2848), 1 (add-project back button/spacing).

## Verification
- Full unit suite green (exit 0, "ALL PASS", browser-check surface gate 0 FAILED).
- Targeted: web.layout-picker / web.controls-1303h / web.consolidated-867 / web.consolidated-980 green.
- Surface gate: `bc-surface-map.sh covering` over the diff returns empty (no annotated
  surface changed) - so no browser-check needs updating.
- Visual: index.html's consolidated view cannot be rendered from this session (needs the
  running board with data). Josh reviews live per his standing rule.
