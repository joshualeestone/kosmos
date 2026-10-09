# winopenflake-5710: the main() end-to-end opener test waits on receipt

Card: #5710. Test-only change to tools.win-open-board-2007.test.js.

## Problem
The test polled the stand-in opener's output file for a fixed 4 s (40 x 100 ms). Under full-suite
load the detached opener had not written by then: actual '' (Mona Lisa, redwhy-5692). Alone it
passes 3 of 3.

## Change
- makeOpener's stubs (bash and the Windows .NET exe) write to `opened.txt.part` and rename it to
  `opened.txt`, so the file appears only once complete.
- The end-to-end test polls until the file is non-empty, up to a 30 s deadline, every 50 ms. The
  deadline only bounds a failure; a pass returns on receipt.

## Rejected
- Waiting on the opener's exit: it is a detached grandchild of the helper subprocess; the test has
  no handle on it.
- Raising only the fixed window: still a race, just a rarer one.

## Weakest premise
That 30 s exceeds any load the suite produces. No per-test timeout is configured in the repo, so a
longer wait cannot be cut off by the runner first.

## Controls (measured)
- Opener delayed 6 s: origin/main's test fails ("did not receive the nonced url"), this one passes.
- Opener handed the plain url: this test fails at once (non-empty file breaks the poll).
