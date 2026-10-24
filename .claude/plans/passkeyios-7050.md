# kosmos#7050 slice C: passkey sign-in on the iPhone, natively

Slice A (kosmos-relay #587) put passkey sign-in on the coordinator; slice B (#588) put it on the web page. Inside the
app's web view the page offers no passkey (no association there), and the native sign-in's "Sign in with a passkey"
link opened that web page, so it led nowhere. This slice signs in with a passkey natively.

## Finished looks like

With the coordinator's passkeys on, the native email step shows "Sign in with a passkey". Pressing it asks begin for
a challenge, opens Apple's passkey sheet for the coordinator's host (the app's webcredentials association, relay #584),
sends the assertion to finish with this iPhone's device id, and spends the grant at verify exactly as a company
sign-in's grant is spent, so the second step and the Allow follow as for a code. With passkeys off (begin 404) no
passkey link shows. Logic tests prove the offer, the finish body and the finish answer. Broken-copy control, run
2026-10-24 on this branch (ios/LogicTests/run.sh against a copy with the relying-party check removed): exactly the
other-host and lookalike-host cases failed (2 of 1081), then passed again on the real sources.

## Design

- SignInLogic: passkeyOffer (200, challenge decodes, rp_id is exactly the coordinator's host, user verification
  required), passkeyFinishBody (base64url, device id, user handle only when present), passkeyFinish (a kpk1_ grant with
  a usable email, sso_required in the app's words, else the coordinator's sentence or a general one).
- SignInClient: passkeyOffer (POST begin), passkeyAssert (ASAuthorizationPlatformPublicKeyCredentialProvider,
  user verification required, one answer handed back on the main queue), passkeyFinish.
- SignInModel: asks once when the screen opens whether passkeys are offered; a press takes a fresh challenge, the
  attempt guard drops a stale answer, a refused grant goes back to the email step with the sentence.
- The web link stays only for a company sign-in on iOS before 17.4.

## Not in this slice

Adding a passkey from the app (the /account page in Safari does it). Turning the flag on (gated on #7050: a real
Safari and iPhone check).
