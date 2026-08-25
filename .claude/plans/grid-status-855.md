# Plan: grid-status-855

Josh, #chaoskosmos-design, 2026-08-25 10:22, on the agents grid view.

His words: "let's take off these things that say 'said so' itself... In
fact let's do away with the status line altogether. It's just junking up
the page. I'd rather just stick with the idle, needs something, or
working buttons and then we could move the model that they're on higher
up and reduce the overall height of these boxes."

## Changes

- [x] Removed the grid card's provenance line ("Said so itself" /
      "Read from its screen") entirely -- scoped to the grid card only,
      by name. The list row and the detail panel keep it; `saidLine()`
      itself is unchanged, still backing both of them.
- [x] Moved the model line from the bottom of the card to right after
      the state pill, ahead of the task line.
- [x] Height reduction follows from removing a row, not a separate rule:
      `.acard` has no fixed height to adjust.
- [x] Removed the now-dead `.asaid` CSS rule.
- [x] Corrected a stale comment (both on `.asaid`'s own rule and on the
      list row's markup) that claimed the card and the list row "cannot
      disagree" about the said line -- true when both rendered it, no
      longer accurate once one of them stopped.

## Verification

- [x] `web.said-line.test.js`: two new tests (the card no longer calls
      `saidLine()`/carries `.asaid`, and the model line's position
      relative to the state pill and task line), plus the existing
      "three surfaces" test rewritten to "two surfaces" now that the
      card is deliberately out.
- [x] `web.not-running.test.js`: unaffected (a separate, simpler card
      template for stopped/not-running agents that never included model
      or task at all), re-run to confirm no regression.
- [x] `npm test` (full suite): 0 failures, exit 0, run twice (pre- and
      post-rebase onto main, which picked up an unrelated cut-blocking
      fix -- render-projects -- from earlier this hour; not caused by
      and not related to this branch).
- [x] `bash tools/browser-checks.sh` (full suite, post-rebase): all page
      checks passed.
