# agyqueue-8883: Antigravity's queued count includes lines sent automatically (kosmos#8883)

Follow-up from #8864's round 4 review (PR #8873). Stacked on wakelabel-8864, because the bracket it counts exists only
there; it merges after #8873.

## Built
- engine/status.js antigravityQueued: the queued-line pattern also matches `[sent automatically on this computer`
  (messages.automaticWake), so a wake hello or a script's boot notice queued on an Antigravity pane is counted.

## Tests
engine/msgqueue-5187.test.js: a pane with two colleague lines and one automatic line reads n: 3; CONTROLS: without
the queue prompt it is null, and the colleague lines alone read 2. Reverting the pattern turns the test red (restored).

Weakest premise: that Antigravity draws a queued automatic line with the same leading `▸ [` as any other queued
message. It draws whatever was typed, and the bracket is typed first, so it should; not measured on a live agy pane.

## Round 1 (opus, blind): nothing above nit
- Measured the old and new patterns on the real bracket: anchored, no over-match of `[from Kosmos]` or
  `[background from your colleague` (both skipped before too; a pre-existing gap, not this card's). It is the only
  pane-scraping counter keyed on `[message from`. Nit taken: the bracket with no time label is now tested as well.
- Noted: the 35-line window can count a delivered line still on screen above the queue, already true for
  `[message from` and most likely just after a wake.

## Round 2 (sonnet, own commits, blind): nothing above nit. Converged.
Related set (every test that loads engine/status.js or names antigravity): 268 files, 5,155 tests, 0 failed.

## Next
After #8873 merges: rebase this branch onto main (only its own commits), run the full validation, then the PR. Its
diff against main is then only status.js, the test and this plan.
