# kosmos#8959 slice B1b: the second step on the native Kosmos+ account screen

Scope decision: card comment 7124090978. The page's two things, native: say the step is on (with the reset and
lost-phone words), and offer one when none is (texts when Kosmos+ can send them, or the authenticator app). No change or
remove (the page has neither; remove needs a fresh email code, a later slice B1b2).

Stacked on slice B1a (branch accountnative-8959, PR #8980) until it merges; then rebased onto main.

## Done
- [x] `ios/Kosmos/AccountSecondLogic.swift`: `GET /v1/second` read (a missing `enrolled` is unreadable, never "none"),
      the request builders (slice A's enrol and confirm bodies, the text enrol's longer wait), the page's words, the
      choices, `sms_unavailable`, the six-digit code, and `confirmed`, which returns the FRESH session confirm hands back
      (second.rs confirm, kosmos#3860). A 401 is not "signed out" by itself: Kosmos+ answers a wrong code with 401, so only
      a sentence `SignIn.startsOver` reads as ending the sign-in signs out; a 400 that says start again closes the setup.
- [x] `ios/LogicTests/run-accountsecond.sh` + `accountsecond/main.swift` (66 checks, a CI step), words compared with
      origin/main's signin.html; mutants each caught.
- [x] AccountView "Two-step sign-in" section and a setup sheet (number, texted code, authenticator key) with slice A's
      words. Confirm's fresh session goes through `PushNotificationManager.sessionRenewed` (the registrar alone: not an
      account change), which then moves BoardClient's kept state (the kept Mac session, the shown list and the open
      chat are keyed to the session) with `BoardClient.sessionRenewed` / `Board.rekeyed`, then `web.forget(old)`.
      Tested in ios/LogicTests/main.swift ("a renewed session of the same account"). Residual: if the keychain refused the fresh session, nothing is moved and both the
      reloaded web page and the Agents tab end signed out, as after any refused keychain save.
- [x] KosmosUITests `AccountScreenUITests.testSecondStepOfferedThenOn` (ui-sample count 2). The test itself takes one
      set of shots under the simulator's appearance; light and dark were both run by hand (the simulator's appearance
      set to each), not by the test.

## Next
- [ ] Rebase onto main once B1a is in.
- [ ] Challenge loop (8-round cap), full validation, PR "Addresses #8959 (slice B1b)".
