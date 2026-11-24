# kosmos#8959 slice B1c: passkeys and sign-ins from new places on the native Kosmos+ account screen

Model: the web account page (kosmos-relay signin.html loadPasskeys/renderPasskeys/removePasskey/passkey-add,
loadNewPlaces/renderNewPlaces/notMe) and its words. Routes measured in passkey.rs and second.rs (origin/main 2026-11-24).

## Done
- [x] `ios/Kosmos/AccountSecurityLogic.swift`: list (404 off, 401 signed out, a failure keeps the section), row lines,
      remove, step_up_required words, register/begin read (only ES256 / attestation none, as an iPhone passkey is),
      `authData(attestationObject:)` (a small definite-length CBOR walk: iOS hands back the attestation object, the
      relay wants authenticator_data), finish body, new places list and lines, Not me (2xx or 401: signed out everywhere).
- [x] `ios/LogicTests/run-accountsecurity.sh` + `accountsecurity/main.swift`, 79 checks; words compared with origin/main's
      page; five mutants each caught by its own check.
- [x] CI step in `.github/workflows/ios.yml`.
- [x] `ios/Kosmos/PasskeyMaker.swift`: Apple's registration sheet (user verification required, attestation none,
      excludedCredentials on iOS 17.4+; answers made / cancelled / alreadyHere / failed). Typechecks against the iOS SDK.

- [x] Stacked on B1b (accountsecond-8959, PR #8994) at 10:05; rebase --onto origin/main once #8994 merges.
- [x] AccountView: Passkeys section (404 hides it; Remove asks first in a confirmation dialog with the page's words;
      Add = begin, PasskeyMaker, finish named "iPhone"; step-up and Kosmos+'s own refusals shown) and "Sign-ins from new
      places" (shown only with a row; Not me asks first; success signs this iPhone out the app's own way).
      Request builders in AccountSecurity, checked: 88/88 (KOSMOS_RELAY = an origin/main copy of the page); a mutant Not
      me body is caught. "More on Kosmos+" footer drops "passkeys" when the section shows.
- [x] AccountScreenUITests.testPasskeysAndNewPlaces; ui-sample.sh AccountScreenUITests:3.

## Next
- [ ] UI light+dark (queued 10:08), read the shots.
- [ ] Rebase onto main after #8994; challenge loop (8-round cap), full validation, proof, PR "Addresses #8959 (slice B1c)".
- [ ] Associated domains: webcredentials:login.kosmosplus.com covers Kosmos+'s own rp_id; a self-hosted Kosmos+ with
      another rp_id gets Apple's refusal, told as "That passkey could not be added." (documented residual).
