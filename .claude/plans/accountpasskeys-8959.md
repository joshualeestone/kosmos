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

## Next (waits for B1a, branch accountnative-8959: the screen it goes on)
- [ ] Rebase onto main once B1a is in.
- [ ] AccountView sections. Add uses ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
      .createCredentialRegistrationRequest(challenge:name:userID:), excludedCredentials from `exclude` (iOS 17.4+;
      older: InvalidState from finish is told as addHave). Remove and Not me ask twice, as the page (a confirmation
      dialog on the phone). Not me's success goes the app's sign-out way.
- [ ] Check the app's associated domains cover the rp_id the relay sends (native passkey sign-in already uses it).
- [ ] KosmosUITests: light and dark shots. Challenge loop (8-round cap), full validation, PR "Addresses #8959 (slice B1c)".
