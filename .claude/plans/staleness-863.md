# Plan: staleness-863

Josh, #chaoskosmos-design, 2026-08-25 10:41.

## Changes

1. **Grammar fix.** The staleness sentence joined project names with a
   bare comma and appended ", and told it in its pane" right after --
   with three or more projects the last name and "told it in its pane"
   read as the same kind of list item. New `andList()` in
   `engine/projects.js`: one name unchanged, two get a plain "and",
   three or more an Oxford comma before the final "and".
2. **A real done state after "Add them."** A bare "Added." left both
   dialog buttons standing as though nothing changed. Now: "Added. You
   can close this dialog." (his own suggested wording), Add them
   disabled, Keep as it is relabeled Close and focused. A fresh open of
   the dialog (even for a different agent) resets both controls.

## Investigated, not built

- The date-prefix inconsistency between Marilyn's and Anna's
  sentences (his own note flagging it as worth checking). No code path
  found that would prepend a date to this sentence -- most likely a
  real project literally named with a timestamp, which is accurate
  information rather than a formatting bug, but I can't confirm this
  without his live machine. Left as is.
- The "gigantic amounts of text" question -- the issue itself says
  this needs a second look against what that panel is supposed to show
  before being treated as a defect at all. Not investigated further
  here; still open.

## Verification

- [x] `npm test` (full suite) -- new tests added: a direct
      `engine/projects.test.js` test pinning the two- and three-name
      "because" strings through a real multi-project sync (no mocking
      of the join logic); a `web.doctrine-consent.test.js` test pinning
      the done-state message, the disabled button, the relabeled/
      focused Close button, and the open-handler's reset of both. One
      pre-existing test's fragile first-occurrence string search
      needed a comment reworded (my own explanatory comment
      accidentally contained the exact literal it was warning about
      colliding with) -- caught by running the suite, not assumed safe.
      0 failures.
- [x] `bash tools/browser-checks.sh` (full suite) -- see pre-challenge
      proof.
- [ ] The repo's own headed interactive check for this exact dialog
      (`tools/headed-doctrine-check.js`, Tab-trap/Escape/focus-return)
      was NOT run -- it targets a specific "born-before" server fixture
      I did not have standing, and this repo's own convention already
      treats it as a separate, not-always-run layer beyond the
      source-level pins in `web.doctrine-consent.test.js` (its own
      header: "what can rot HERE is the copy and the wiring... the
      BEHAVIOUR is driven headed" separately). My new test's assertions
      are source-level, matching that file's own established pattern.
