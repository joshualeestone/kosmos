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
