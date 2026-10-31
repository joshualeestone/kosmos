# pbwarn-7681: four personal-backup warnings settled before the switch goes on (kosmos#7681)

Stacked on Baron's personal-backup branch, then rebased onto main once it merged (#7683).

## The four items
1. **Price.** The price shown must equal a `price` in the coordinator's preview answer, or nothing is turned on. The
   coordinator sends none yet, so a board showing a price turns nothing on until #7685 (coordinator billing for the
   personal backup price) lands. Baron agreed, 11:17 on 10-31.
2. **Print.** The page prints itself with a print-only rule that shows only the code. The hidden frame was dropped
   instead of hunting for a frame size every browser honours.
3. **Restore.** It re-reads the record after each await, so a turn-off in the meantime stops it, and it re-checks
   inside the key write.
4. **Finish setting up.** When there is no code to show, it says the key is set up.

## Review
2 blind rounds. Round 1's warnings fixed at e73eee281b; round 2 had no blocker or warning, and its nits are taken at
e2e97cbc6e.

## Not proven
Each item's check has a mutant that turns its arm red, and item 2 has a headless print-media check. Nothing ran in a
real browser's print dialog.

## After the full suite (10-31 14:0x)
The first full suite had 5 reds, all this branch: a static #pb-printout was a 43rd body child (the layout test),
pbPrintClear looked it up by id (the page harness stubs every id), and the browser-check gate wanted a trailer. The
printout is now made only to print and held in PB. #7694 carries the real-browser print check (needs-device).
