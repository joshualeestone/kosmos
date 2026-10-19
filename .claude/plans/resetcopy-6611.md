# resetcopy-6611: the second-step reset says every phone and browser will sign in again (kosmos#6611)

## Goal
kosmos#6605 (relay PR #465) makes a computer's reset of the second step end every session on the account. The Mac
app's reset dialog said only that it switches the second step off, and its done message said only to sign in from
the new phone. The person should hear about the sign-out before agreeing, and again after.

## Change (as of round 5; the round sections below say how it got here)
- web/index.html: the dialog's opening line, the armed line and the done line say every phone and browser will need
  to sign in again. The done words follow what the coordinator reported clearing: a kind gets the sign-out sentence;
  null gets "There was no second step on your account to switch off, so nobody was signed out. If you had started
  setting one up, start again."; an answer that did not say (it went wrong) gets the words from before #6605.
- engine/remote.js secondReset reads `had` from the connector's answer; server.js passes it on (absent stays absent).
- Tests: web.lost-phone.test.js (6), server.remote-second-reset-6611.test.js (4), engine/remote.test.js #733 (kind,
  null, absent, garbled, number, empty), docs/browser-checks/render-plus-panel-3829.js (the rendered done message).

## Order
Ships AFTER the coordinator deploy carrying #6605; before it, the sentence would be false. Kosmos main is also under
the 0.7.60 cut hold (Splinter 12:04). Merge only after both.

## Tests run
See the latest round's section: the full runs are listed there with the commit they ran on.

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
  carrying #6605 is measured live and the cut hold has lifted. `had` is NOT a guard for this: a coordinator without
  #6605 also answers `had`, so every sign-out sentence (the dialog's opening line included) is held by the merge order
  alone.

## Challenge-loop round 3 (addressed)
- The "none" words no longer say "nothing changed": a reset with no factor still cancels a set-up not yet confirmed.
  They say nobody was signed out and, if a set-up was started, to start again.
- A `had` of any type other than a string or null reads as unknown (the words that claim nothing), never as none.
- The absent case is described as an answer that went wrong, not an older connector (every connector since
  2026-08-25 prints `had`).
- server.remote-second-reset-6611.test.js pins the route: a kind and null pass through, absent stays absent, a
  refusal is the engine's words. engine/remote.test.js adds garbled and wrongly typed answers, with the env var reset
  in a finally.

## Challenge-loop round 4 (addressed)
- An empty-string `had` reads as unknown, not as a cleared kind (tested with the others).
- Deliberate, not changed: the dialog's opening line and the armed line speak before `had` is known. The opening line
  is conditional by its grammar ("Switching it off also means ..."), and the armed line describes the case this
  dialog exists for (a lost phone, so a factor is on). For an account with no factor the done words correct it
  ("nobody was signed out"). Hedging both lines with "if the second step is on" was rejected: it adds a condition a
  person at this screen almost never meets, to every person who does.
- Ran on 5b09ace6cf: engine/remote.test.js 236/236, web*.test.js 391 files 3053/3053, the two server route files
  (server.remote-second-reset-6611 4 and server.remote-forget-6389 4) 8/8,
  the plus-panel browser check 149/149.

## Challenge-loop round 5: converged
No new defect. Its warning restates the deploy order: the PR opens as a DRAFT titled "[HOLD: after #6605 is live]",
and comes out of draft only after a session issued before a reset is shown refused after it on the LIVE coordinator
(not merely after relay #465 merges). Nits fixed: the page, like the engine, needs a non-blank `had` for the sign-out
words; the test comment no longer says "older connector"; this plan's Change and Tests sections are current.
