# chevwrap-5053: a long project name never pushes the Tasks back chevron off the title's line

Card #5053 (found by #5052's Linux measurement; Splinter asked for the fix, 14:01 CDT 2026-10-02).

## Measured
At 390px on a Mac the `.tsk-head` row is 314px; chevron 32 - 4 + 16 gap + title 241 ("1 Task on Five Families") =
285, so 29px spare. Linux: 299px row, 258px title, 302 needed, wraps. A longer name wraps on the Mac too.
render-subback-4586 with a long-name arm ("Five Families Holdings"), on main, on this Mac: red at 390 and 360
(`gap -32, overlapY -16`).

## Change
web/index.html: `#panel-tasks .tsk-head` flex-wrap: nowrap; `#tsk-title` min-width: 0, overflow-wrap: anywhere;
`#tsk-new` flex: none. The chevron was already flex: none. Desktop unchanged.
docs/browser-checks/render-subback-4586.js: the long-name arm (renames the fixture's project, restores it after).
docs/browser-checks/mobile-shots.js: a `project-tasks` screen for design shots.
Only one other head uses `.sub-back`: #pj-docs-view .pjtitle is a grid with the chevron in its own column, already
robust; not changed.

## Decisions (reversible)
- "+ New task" stays on the title's row (it used to drop below); the title wraps in a narrower column. The
  alternative (New task below, title full width) is offered to the design reviewer (Mona Lisa) on #5053.
  Weakest premise: a four-line title beside a centred chevron reads well enough on a phone.

## Verification
- render-subback-4586: 35/0 with the fix on this Mac; red on main at the new arm only.
- The 12 checks tools/bc-pr-select.js selects for this diff (queued, Agent1s).
- Design shots: ~/work/design-shots/kosmos-5053 (project-tasks, tasks; desktop and iPhone 15; light and dark).

## Iterations
(filled in by the review loop)
