# Plan: create-step2-858

Issue #858: Josh, 2026-08-25 10:28, reversed an earlier flush-left
instruction mid-message; the centered version he settled on is the one
this builds. "This page looks pretty good" otherwise, per his own close.

## Changes

1. **Center everything**: `#cstep-made { text-align: center; }` (the
   title, via inherited inline alignment) and `.tick { justify-content:
   center; }` (each checklist item, the icon+text pair, centered as a
   unit -- explicitly NOT column-aligning the icons across rows, per
   his own words: "I don't care that the checks don't line up. It's
   more about the items.").
2. **More top breathing room for the K animation**: `.made-mark`'s top
   margin nudged from `0` to `var(--space-4)`.
3. **The invitation callout gets a real box**: thin gold border,
   light-gold background (`rgba(214,166,46,.10)`, the same tint recipe
   this file already uses elsewhere for a gold wash), padding sized to
   read close to the button's own height.
4. **"hello" in quotes**: the invitation text now reads `Say "hello" to
   your agent to activate it on Kosmos.` (curly quotes, matching how
   this file quotes elsewhere).

## Verification

- [x] The dedicated, pre-existing check for this exact screen
      (`docs/browser-checks/render-create-made.js`) drives the real
      Create flow end to end. Updated its one assertion that pinned the
      old unquoted text (a regex, not a literal string, so only the
      "hello" portion needed adjusting) -- 18/18 pass, including
      "the last step is on screen and centred" (pre-existing,
      unaffected) and the updated hello-text assertion.
- [x] Screenshot of the real, driven flow (via a scratch copy of the
      same check with one added screenshot line, not committed)
      confirms visually: centered title, centered checklist items with
      unaligned check marks, the gold-bordered callout box, quoted
      "hello", a small gap before the button.
- [x] `npm test` (full suite): 0 failures.
- [x] `bash tools/browser-checks.sh` (full suite).
