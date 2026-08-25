# Plan: installing-steps-clear

Pigeon Pete, peer HEADS-UP x2, 2026-08-25, screenshotting the taken
branch on real served 0.5.33 (then 0.5.34) bytes rather than guessing
from the diff.

## The bug

`#895` rewrote the taken-branch copy to be honest that the board
answering is often a different macOS account's, not the reader's own.
It only touched the `#taken` div's own content. The `#steps` line above
it ("Setting up. This usually takes a minute or two.") is never
cleared or rewritten on that branch -- only `#hint` is. So the page
showed both sentences at once: one promising an install still in
progress, the other saying the thing it would have installed is
already answering, occupied by someone else. Pete's exact framing:
"two sentences in tension."

This predates #895 -- it was already true the moment #892/#893 shipped
the taken branch at all -- but #895 is the commit riding into 0.5.34,
so it is the natural place to fix it before that cut freezes further.

## Change

One line in the `img.onload` handler's `if (first) { ... }` branch:
`document.getElementById("steps").textContent = "";`, clearing the
line the same way `#hint` was already being hidden.

## Verification

- [x] `node --test install.installing-page.test.js` -- new test slices
      the taken branch and asserts it clears `#steps`. 7/7 pass.
- [x] `npm test` (full suite): 0 failures, exit 0.
