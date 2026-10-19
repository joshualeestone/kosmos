# resetcopy-6611: the second-step reset says every phone and browser will sign in again (kosmos#6611)

## Goal
kosmos#6605 (relay PR #465) makes a computer's reset of the second step end every session on the account. The Mac
app's reset dialog said only that it switches the second step off, and its done message said only to sign in from
the new phone. The person should hear about the sign-out before agreeing, and again after.

## Change
- web/index.html, PLUS_SECOND_WORDS: the armed (confirm) line adds "every phone and browser signed in to your
  account will need to sign in again"; the done line adds "Every phone and browser will need to sign in again."
  The done line keeps its first sentence "The second step is off." whole (a test and a browser check pin it).
- web.lost-phone.test.js: both sentences asserted. docs/browser-checks/render-plus-panel-3829.js: the rendered done
  message asserted (ran headless, 149 passed, 0 failed).

## Order
Ships AFTER the coordinator deploy carrying #6605; before it, the sentence would be false. Kosmos main is also under
the 0.7.60 cut hold (Splinter 12:04). Merge only after both.

## Tests run
web.lost-phone.test.js 4/4; the full web*.test.js sweep from the worktree, 391 files, 3051 passed; both
browser-check gates (coarse refused before the check was updated, passes after).

## Weakest premise
That "every phone and browser" is the right word for what ends: it is every SESSION (phone or browser sign-ins); the
computers' own signed requests carry on, so the Macs themselves are not signed out, and the copy does not say they are.
