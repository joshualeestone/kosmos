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

## Challenge-loop round 1 (addressed)
- The dialog's opening paragraph (#plus-lost-say) also says switching the step off signs out every phone and browser,
  so the person reads it before pressing anything; asserted in web.lost-phone.test.js.
- (Round 1 first recorded the no-factor case as a residual on two premises that round 2 showed false: the connector
  DOES print the coordinator's whole answer, `{"ok":true,"had":...}`, and "enrolled" means this Mac is registered,
  not that the account has a factor, so a second press after a reset would hit it. Retracted; fixed in round 2.)
- Order: still merge only after the coordinator deploy carrying #6605 is measured live, and after the cut hold lifts.

## Challenge-loop round 2 (addressed)
- engine/remote.js secondReset reads `had` from the connector's answer (lastJsonLine of its stdout) and returns it:
  a kind, null (nothing was cleared), or undefined (an answer without it, an older connector). server.js passes it
  on. The page says the sign-out only for a kind; for null it says nothing changed and nobody was signed out; for
  unknown it uses the words from before #6605, which claim no sign-out.
- Tests: engine/remote.test.js (the fake connector answers `second reset` like the real one; FAKE_SECOND_HAD picks
  totp, null or absent), web.lost-phone.test.js (all three answers), the browser check's stub answers with had.
- The dialog's opening line no longer says "signs out" in the present tense: a running computer learns the cutoff on
  its next check, so it says every phone and browser "will need to sign in again", like the other two lines. The
  armed line is three short sentences.
- Ran: engine/remote.test.js 236/236; web*.test.js sweep 391 files, 3053/3053; the plus-panel browser check 149/149.
- Order (round 2 asked for a mechanical hold): the PR is opened as a DRAFT and stays one until the coordinator deploy
  carrying #6605 is measured live and the cut hold has lifted.
