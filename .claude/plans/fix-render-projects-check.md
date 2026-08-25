# Plan: fix-render-projects-check

Baron Draxum, cross-machine, 2026-08-25 13:17: cut 0.5.31 (frozen sha
8cf73d8, carrying #879, #880, #882) died at step 3b. `render-projects`
failed twice, same line: "a description at the cap should wrap fully
on the pack card, unclipped: {"lines":0,"clippedX":false,"clippedY":false}".

## Root cause, confirmed by direct reproduction

The default projects view is grid. `.pc-t` there has `display: none`
since PR #882 (2026-08-25), which deliberately dropped the description
from the grid card's stack per Josh's #861 ask (his own four-item list
-- title, status bubble, icons, count -- named no description, and the
agents-grid card it's modelled on carries none either; disclosed as a
judgment call in #882's PR/plan/Discord post at the time). A
`display:none` element's `getBoundingClientRect()` is all zeros by
spec, which is exactly the `lines:0, clippedX:false, clippedY:false`
signature -- not a layout bug, and not truncation (which would read
`lines:1` with a clip flag true).

`render-projects.js`'s wrap-fully pin predates both #860 (list row now
truncates a long description to one line, superseding "wraps fully")
and #861 (grid card drops the description entirely). Two of Josh's own
same-afternoon asks superseded a check that was correct when written.

A second, related gap: the file's own contrast pass (further down the
same file) measured `#panel-projects .pj-row .pc-t` against whatever
`?tab=projects` defaults to (grid), so it silently lost real contrast
coverage for the description the moment #882 landed -- caught only by
the file's own "missing selector is a hard fail" discipline.

## Changes

Both in `docs/browser-checks/render-projects.js`, no production code
touched:

1. **2b-description's wrap-at-cap assertion** now checks BOTH views:
   grid asserts the element is present in the DOM but `display: none`
   (catching an actual removal as a different failure than the
   intentional hide); list asserts exactly one clipped line.
2. **The contrast pass** now explicitly switches to list view before
   measuring, restoring `.pc-t`'s coverage (list is where every
   selector that pass names still genuinely renders).

## Verification

- [x] Direct reproduction against a live server, matching the check's
      own logic exactly, before writing the fix: confirmed
      `pj-list` class is `pj-list asgrid` by default and `.pc-t`'s
      computed `display` is `none` there.
- [x] `bash tools/browser-checks.sh render-projects`, twice: once
      (correctly) caught my own mistake of running it uncommitted,
      which froze the pre-fix code and reproduced the original
      failure exactly -- confirming the harness's freeze-at-last-
      commit behavior is working as designed, not a false pass. Once
      committed, both the 2b-description and 7-contrast passes went
      green.
- [x] Full `bash tools/browser-checks.sh` (all checks, not just
      render-projects): "all page checks passed".
