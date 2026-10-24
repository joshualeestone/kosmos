# #7042: iPhone slice 5a, native sign-in (email, code, second step, allow on your Mac)

Part of the iPhone plan #6838 (slice 5). Splinter, 06:13 10-24: take the next native slice nobody holds.

## What exists (measured 06:2x 10-24, kosmos-relay origin/main, kosmos origin/main)
- The app starts its web view at login.kosmosplus.com/, which is the sign-in page and, once signed in, the door to
  the person's Mac. The page hands the session to the app through `kosmosSession` (PushNotificationManager
  handleSessionMessage -> registrar.didReceive), and keeps its own copy in the HttpOnly `__Host-kosmos_session`
  cookie (websession.rs; POST /v1/session/adopt with the token as Bearer and `x-kosmos-web: 1`, same-origin).
- Phone sign-in routes: POST /v1/signin/start {email, device_id, device_name} (same answer for any address; may
  carry sso_url / sso_required); POST /v1/signin/verify {email, device_id, device_name, code, device_key?,
  device_sig?} answering one of: a session {token, expires_at, device_status, match_code, addresses,
  waiting_labels}, a second step {second: "sms"|"totp", challenge, sent_to}, an enrol-only token {enrol: true}, or an
  error {error, code} (device_proof_refused among them); POST /v1/signin/second {challenge, code} -> a session.
  The Allow is watched by GET /v1/account/me every 3 s (device_status acked / denied).
- Device proof (#5422): a `k1.` id is the first 32 chars of base64url(SHA-256(SPKI DER)); the device signs
  "kosmos-device-v1\nsignin\n<email as sent>\n<code>\n<id>" with ECDSA P-256 SHA-256, raw r||s, base64url. A
  legacy id is replaced by a new random one at every fresh sign-in, so it would need the Mac's Allow every time.

## Finished looks like
1. Not signed in, the app opens native sign-in screens instead of the web sign-in page: email, code (with send
   again and use a different email), the second step (SMS or authenticator), and "Allow this iPhone on your Mac"
   with the match code until the Mac says yes or no.
2. The session reaches the same place the web bridge's does (registrar.didReceive(.signedIn)), and the web view is
   signed in too (adopt, run on the sign-in page itself), so nothing later asks again.
3. A company's own sign-in (sso_required), a second step not set up yet (enrol), and passkeys hand over to today's
   web sign-in page, with one line saying so. Making an account stays on the computer.
4. A keyed device id: one P-256 key per app install, in the Secure Enclave on a device, in the keychain on the
   simulator, so the Mac's Allow is asked once, not on every sign-in.
5. Logic tests: the proof against the coordinator's own WebCrypto vector (id and signature, with a control), the
   answer parsing for all four verify shapes, the request bodies, the adopt script (token escaped), the steps.
   Shots on the simulator from sample data: light, dark, largest text.
6. A real sign-in needs a device and a release: needs-release.

## Rejected
- Unkeyed device id: the coordinator replaces it at every sign-in, so the person would allow this iPhone on the Mac
  every time.
- Setting the web view's cookie directly (WKHTTPCookieStore): it would copy the coordinator's cookie rules into the
  app; adopt is the route made for moving a session into the site's cookie.
- Building company sign-in and passkeys now: each is its own security surface (5b, 5c).

## Weakest premise
That running the adopt fetch on the sign-in page from the app counts as the site's own page (same-origin, the
header). Measured from websession.rs, not yet on a device. If it does not, the web view shows its sign-in once more
(no harm, but the slice is not finished): the fallback is to load a page with the token handed over by the bridge.
