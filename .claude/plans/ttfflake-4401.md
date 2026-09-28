# ttfflake-4401: render-type-to-focus-3283's NEGATIVE arm clears the draft the way a person does (kosmos#4401)

## Cause (measured)
- The arm typed "hi" into #d-say, then cleared the box with a bare `.value = ''`, which fires no input
  event, so TALK_DRAFTS still held "hi". The thread poll's repaint (paintTalk) restores a parked draft
  into an EMPTY box (web/index.html, "The parked draft comes back, and never over words already in the
  box"). Whenever a poll landed between the clear and the read, the arm saw d-say="hi" with focus still
  on the button, and failed. That was about 2 runs in 5 on origin/main, and it reddened CI's
  browser-checks job on PR #4390.
- The product is right to restore it (never lose a half-typed message). The check was wrong.

## Fix
Clear the box and dispatch an `input` event, so the draft handler drops the parked draft too.

## Proof
- Deterministic: forcing paintTalk between the clear and the keystroke, the old check failed 3/3 with
  the CI message and the fixed one passed 3/3.
- The fixed check, unforced: 5/5.
- The arm still guards what it is for: removing the product's focused-control guard makes it fail
  (`active=TEXTAREA d-say="z"`).
