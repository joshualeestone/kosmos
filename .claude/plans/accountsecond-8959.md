# kosmos#8959 slice B1b: the second step on the native Kosmos+ account screen

Scope decision: card comment 7124090978. The page's two things, native: say the step is on (with the reset and
lost-phone words), and offer one when none is (texts when Kosmos+ can send them, or the authenticator app). No change or
remove (the page has neither; remove needs a fresh email code, a later slice B1b2).

## Done
- [x] `ios/Kosmos/AccountSecondLogic.swift`: `GET /v1/second` read (a missing `enrolled` is unreadable, never "none"),
      the page's words, the choices, `sms_unavailable`, the six-digit code, and `confirmed`, which returns the FRESH
      session confirm hands back (second.rs confirm, kosmos#3860: the old one is refused once a step is on).
- [x] `ios/LogicTests/run-accountsecond.sh` + `accountsecond/main.swift`, 48 checks; words compared with origin/main's
      signin.html (control: one changed sentence fails it); mutants (fresh session dropped; missing enrolled read as
      none) each caught.
- [x] CI step in `.github/workflows/ios.yml`.

## Next (waits for B1a, branch accountnative-8959, to merge: the screen it goes on)
- [ ] Rebase onto main once B1a is in.
- [ ] AccountView section: state or offer; enrol through slice A's `SignInClient.enrol` with the account session as the
      bearer; slice A's text and authenticator confirm screens; on `.on(fresh:)` store the new session through the app's
      own session store (the same path sign-in uses) BEFORE anything else asks Kosmos+; `.onSignInAgain` and
      `.signedOut` go the app's sign-out way.
- [ ] KosmosUITests: light and dark shots of the on state and the offer.
- [ ] Challenge loop (8-round cap), full validation, PR "Addresses #8959 (slice B1b)".
