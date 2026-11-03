# restorelive-7816: the restore screen's end line, polite in its own task

Card: kosmos#7816 (follow-up to #7801, from its review round 8). Owner: Baron Draxum. Base: main at a99c427725.

## What
1. `#pb-files-last` turns `aria-live="polite"` in a zero-timeout callback of its own, after the paint that first showed
   the board's answer, never in the task of a write. Before that it is `off`.
2. Turning personal backup off (`pbfShow(false, true)`) resets the switch and empties the end line itself.
3. `docs/browser-checks/render-pbrestore-end-7801.js` asserts aria-live: off in markup, off in the task of the first
   fill, polite after its callback, polite when the end is written (Chromium and WebKit).

## Decided
- No `PBF.gen` guard on the waiting switch: Off clears `PBF.status`, which the callback checks, and the gen guard made
  the line wait one extra paint after Off then On (a mutant removing it stayed green).

## Tests
- web.pbrestore-7404.test.js: timers held and run by hand; two reads with no paint between; Off resets; a switch
  waiting across Off does nothing. Each red under its own mutant.
- The browser check goes red in both engines under the same-task mutant.

## Out of scope (still open from #7801)
- A restore that starts and ends between two 60-second idle reads leaves an old list up.
- A failed partial restore does not say how many files landed (needs Mona Lisa's words).
