# Plan: project-name-overflow

Issue #905, filed 2026-08-25 (0.5.36 walk): "In the consolidated layout's
projects rail, a project name longer than the rail's width is not
truncated: the name's `<b>` renders at its natural width, centered, and
escapes the column on both sides."

## Root cause

The rail reuses `#pj-list`'s markup unchanged whatever sub-layout (`list`
or the grid-of-tiles `asgrid`) the person last left the full projects
panel on. `#pj-list` defaults to `asgrid`. Its own rules give `.pj-row` a
centered, flex-column TILE treatment, with `.pjcard-h` dissolved to
`display: contents` -- so `.pjname` became a bare flex item with no
bounded track to shrink into. The `text-overflow: ellipsis` rule already
on the name (`.pjcard-h b`, from the earlier consolidated work) was
always correct; it never had a box small enough to actually clip.

Same class of bug as the org-chart issue this file's own docblock already
documents ("state carried in from another screen").

## Change (with a measured wrong first attempt, kept as a comment)

1. Neutralize `#pj-list.asgrid`'s tile-grid inside the consolidated rail
   (`display: flex; flex-direction: column`), so the rail always renders
   list-style rows regardless of the panel's stored sub-layout.
2. First attempt: re-establish `.pjcard-h` as a real CSS grid
   (`minmax(0, 1fr) auto`) with the name and status pill side by side,
   mirroring #879's proven list-view fix. Measured wrong: a verbose pill
   ("No agents yet") still claimed most of the line before the name's
   `1fr` column got a turn, so even a short name ("Book Launch")
   truncated.
3. Actual fix: stack the name and pill instead of sharing a line
   (`.pjcard-h { display: flex; flex-direction: column; }`, name at
   `width: 100%`). The name gets the full row width to truncate against.

## Verification

- [x] Live Playwright measurement against a real 191px-wide rail with a
      seeded 63-character project name: before the fix, the name
      rendered at 437px, escaping the rail by ~112px on each side (an
      un-tied project, empty-fleet pill). After the first (side-by-side)
      attempt, the overflow was gone but a short name ("Book Launch")
      now ALSO truncated to "B..." -- measured and screenshotted, not
      assumed. After the stacking fix: "Book Launch" renders in full,
      the long name truncates cleanly with an ellipsis, both confirmed
      by screenshot.
- [x] `node --test web.consolidated-project-name-overflow.test.js` (new):
      3/3 pass.
- [x] `node --test web.consolidated-match-mock.test.js
      web.layout-picker.test.js web.consolidated-867.test.js
      web.consolidated-avatar-crop.test.js`: 28/28 pass, confirming no
      regression to the other consolidated-view work shipped tonight.
- [x] `npm test` (full suite): 0 failures.
- [x] `bash tools/browser-checks.sh` (full suite).
