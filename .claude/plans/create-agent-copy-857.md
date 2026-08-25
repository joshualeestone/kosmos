# Plan: create-agent-copy-857

Josh, #chaoskosmos-design, 2026-08-25 10:25, on the Create an Agent page.

## Changes

1. **Removed the machine-name syntax explainer entirely.** "After we've
   typed in a name, on this Mac it will be lowercase angelina jolie. You
   will see Angelina Jolie everywhere else." His words: "That's just
   telling us what the syntax is behind the scenes, and a white-collar
   person doesn't care about that so let's remove that line."
   `#create-name-mac`, `createSlugPreview()`, `paintCreateNameMac()` and
   its listener all removed -- nothing else consumed any of them
   (checked: the slug computation existed only to build this sentence).
2. **Folded "you can change this later" into the Model label**, in
   parentheses, regular weight: "Model (you can change this later)".
   His words: "put that in parentheses right next to the model label,
   not in bold, just in the regular font." Reused the existing (already
   in the stylesheet, previously unused anywhere) `.flabel-soft` class
   rather than inventing a new one.

## Verification

- [x] `node --test` on the affected page (regress-a-night.js's model-hint
      check updated to read the new location; the old capitalized-
      sentence regex would not have matched the new lowercase
      parenthetical even if the location hadn't moved -- caught and
      fixed on the first browser-checks run, not assumed correct from
      the unit tests alone).
- [x] `npm test` (full suite) -- 0 failures, exit 0, run twice (before
      and after rebasing onto main to pick up the render-projects
      cut-blocking fix, unrelated to this branch).
- [x] `bash tools/browser-checks.sh` (full suite) -- all page checks
      passed, post-rebase.
