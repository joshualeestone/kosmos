# Plan: consolidated-867

Josh, #chaoskosmos-design, 2026-08-25 11:02, his last note of that
testing round.

## Changes

1. **Default-open a project.** A project auto-opens on the first
   consolidated load (no deep link, nothing already open), one-shot so
   pressing back to the list is not immediately overridden. Picks the
   first project in the person's own sort order.
2. **Flush titles.** Traced an 8px offset between the agents rail title
   and the projects rail title to `#pj-list-view`'s own top padding
   (needed by `#alist`, shared by mistake with the projects rail).
   Zeroed for the projects rail specifically.
3. **The user row stays on screen.** `#rail-me` is now `position:
   sticky`, so a tall right column (many project members, an open
   project) can no longer scroll it away. Confirmed by direct
   reproduction: 20 agents plus an open project put it at y:2240 on a
   700px window before the fix, on screen after.
4. **Hidden agents-rail scrollbar**, still scrollable
   (`scrollbar-width`/`-webkit-scrollbar`). The other four surfaces he
   guessed about (projects, members, files, tasks) have no independent
   scroll region of their own yet, so there's no scrollbar there to
   hide.
5. **Tasks sorted above files.** `.pjsplit` (which stacks Members and
   Files in one element) is dissolved into independent grid items in
   consolidated, the same technique #860/#861 used, so Tasks (its own
   separate aside) can sit between them without a DOM move.
6. **The conversation box fills the available height.** Two approaches
   tried and measured wrong first (both left as comments so a future
   reader doesn't retry them): stretching the column to its grid row's
   height did nothing (the row is itself sized from the right column's
   content, so a short project fed the box the same shortage); a
   viewport-based max-height alone also did nothing on a short
   conversation (a ceiling doesn't grow a box past its natural size).
   What works: a real, viewport-based height on the flex container for
   the box to flex-grow into.

## A test fixed along the way

`render-consolidated-layouts.js`'s "empty centre says what to press"
assertions assumed a fresh consolidated load with a project present
would show nothing open -- exactly the state item 1 retires. Since the
consolidated view's own Back door (`#pj-back`) is hidden there's no
real click that reaches "nothing open" once auto-open has claimed a
project, so the check now forces that state directly (the same
PROJECTS/flag-reset technique its own later section already used for a
different scenario) to keep verifying the sentence-rendering logic the
check exists for.

## Verification

- [x] `npm test` (full suite) -- new test file
      `web.consolidated-867.test.js` pins all six changes at the
      source level. 0 failures.
- [x] `bash tools/browser-checks.sh` (full suite, twice -- once found
      and fixed the render-consolidated-layouts interaction above,
      once clean): "all page checks passed".
- [x] Real live-server Playwright verification throughout development,
      not only at the end: each of the six items was measured against
      a live server (real DOM coordinates, not just source pins)
      before being considered done, including the two dialog-height
      attempts that measured as no-ops before the working one.
