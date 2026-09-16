# Plan: #2926 - vertically center the empty tasks-box invitation

## The bug
Josh (6.59 QA, fresh install): the empty-state text in the Tasks box ("Add a task, or
have an agent add one, to start tracking progress.") is not vertically centered when a
project has no tasks yet.

## Root cause (reproduced with pw-runtime)
`.tk-empty` (the empty-state paragraph) is the sole child of `.tkcards` (`#pj-tasklist`),
a flex column with `min-height: 14rem`. It used `margin: auto 0` to center itself
vertically. But `.panel p:last-child { margin-bottom: 0 }` (line ~2740) has higher
specificity than `.tk-empty` and zeroes its bottom margin, so only `margin-top: auto`
survived and the text bottom-aligned.

Measured (tab view, 16px root): list 224px, text 102px, gapAbove 122, gapBelow 0.

## Fix
Center via the flex CONTAINER, immune to the child-margin override:
- `web/index.html`: add `.tkcards:has(> .tk-empty) { justify-content: center; }` and
  change `.tk-empty` margin from `auto 0` to `0` (the auto was defeated and fights
  justify-content).
- `:has()` is already used 36 times in the file; the board runs in Chromium, so it is
  supported and idiomatic.

## Why it is correct
- Scoped to `:has(> .tk-empty)`, so it applies ONLY when the empty-state is present; a
  populated list keeps `justify-content: normal` and top-aligns its cards (verified).
- Works in both layouts: tab (min-height:14rem box) and consolidated (flex-filled box).

## Scope: this is a CLASS fix, both `.tkcards` empty-states (raised in review, intentional)
The selector is deliberately on the CLASS, not `#pj-tasklist` alone, because BOTH `.tkcards`
consumers carried the identical bug:
- `#pj-tasklist` - the per-project tasks column (the surface Josh reported). Measured 61/61.
- `#alltasks-list` - the all-tasks screen's empty-state ("No tasks on this project yet",
  reached from a fresh project's door). Measured 82/82, free 163 - centers correctly.
Fixing only the reported id would leave the identical bug on the sibling (fix-the-class, not
the-instance). The generic selector is not a regression on either surface: the pre-fix state
was bottom-aligned on both, and centered-or-noop is strictly not worse.

Assertion decision: the browser-check asserts centering on `#pj-tasklist` (the card's surface),
which guards the single shared CSS mechanism. A second automated assertion via the all-tasks DOM
path was judged disproportionate for a one-rule CSS fix (render-tasks.js populates the column, so
reaching the EMPTY all-tasks state needs extra navigation, and a second check file risks the
browser-check wiring guards). The sibling is verified manually via pw-runtime instead.
Weakest premise: if a future change adds an `#alltasks-list`-specific container override that
breaks centering, only manual verification caught the sibling today - mitigated by the selector
being one commented rule that visibly covers both.

## Verification
- Re-measured after the fix: gapAbove 61, gapBelow 61, centered in both layouts.
- Populated list: `justify-content: normal`, first card at top (gapAboveFirst 0).
- Added a `#2926` centering assertion to `docs/browser-checks/render-tasks.js` (needs
  free space AND gap-above ~= gap-below), and PROVED it fails on the old CSS
  (free 122, above 122, below 0) before trusting it.
- Full suite green: 7617 pass, 138 skip, 0 fail, 0 cancelled; `bc-surface-map: 0 FAILED`.

## Scope / non-goals
CSS-only behavior change plus one browser-check assertion. No render-JS change (the
`.tk-empty` markup shape pinned by web.room-761.test.js is untouched).
