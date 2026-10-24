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
   signed in too (the token stored where the sign-in page keeps it, by a script run on that page), so nothing later
   asks again.
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
- Setting the web view's cookie directly (WKHTTPCookieStore), or the adopt route's cookie: the sign-in page does not
  read any cookie (review round 1, below).
- Building company sign-in and passkeys now: each is its own security surface (5b, 5c).

## Weakest premise (current)
That storing the token under `kosmos_session` on the sign-in page's origin is all its restore() needs (read from
signin.html on kosmos-relay main; restore() also calls /v1/account/me, which the token passes). Not yet seen on a
device. If the page changes where it keeps its session, the web tabs ask once more (a key test pins the name on our
side only; nothing cross-repo pins it).

## Review round 1 (blind, 06:3x)
1. [BLOCKER] My premise was wrong: the sign-in page keeps its session in localStorage only (restore(), me() and
   post() send Bearer, never `x-kosmos-web`), so the adopt cookie left the web tabs signed out, and signing in there
   would have made a second device and replaced the native session. FIXED: the script stores the token under the
   page's own key on its own origin, then reloads; no cookie is set (which also removes the round's finding 6, a
   session cookie the page could never clear). Test: run in a script engine with a hostile token.
2. [SHOULD-FIX] A pending session redirected the first web load anywhere else (a notification's chat) to the sign-in
   page. FIXED: it waits for a load on the sign-in host and leaves every other load alone.
3. [SHOULD-FIX] A late answer landed after "Use a different email" (sign-in as the old address), and the Allow watch
   could set done after a cancel. FIXED: an attempt counter (the page's `mine !== attempt`), re-checked after every
   await, and cancellation re-checked after the Allow read.
4. [SHOULD-FIX] A device key the keychain cannot keep read as "Could not reach Kosmos+" forever. FIXED: it goes to
   the web sign-in page. RECORDED residual: a keychain READ error looks like no key, so a new key (and one more
   Allow on the Mac) can follow; SessionStore cannot tell the two apart.
5. [LOW] The Allow watch never stopped on a 401. FIXED: it stops and asks to sign in again. Residual: the ended
   session stays handed over until the app's next 401 elsewhere signs it out.
Recorded, not built (the web page does them at sign-in, none safety-related): the optional second-step offer, the
standing / unpaid notes, a notification tap waiting on sign-in.

## Review round 2 (blind, 06:4x)
1. [SHOULD-FIX] The session waiting for the web page lived only in memory: an app restart before any web tab opened
   lost it, the page asked again, and signing in there made a second device. FIXED: no copy in memory. Whenever the
   sign-in page loads holding no session while the keychain holds one, it is stored there. (Round 3 corrected both
   halves of this line: the heal now overwrites any other value, and the page's sign-out removes its own copy FIRST,
   then tells the app over the bridge.)
2. [SHOULD-FIX] The store reloaded "/" and threw away the page it ran on (Settings' account page). FIXED: reload().
3. [SHOULD-FIX] "denied" at verify is not final on the server (signin.rs turns it back into a fresh Allow), but the
   screen stopped there. FIXED: Step.denied(asking:) keeps watching; only the Mac's second no stops it.
4. [LOW-MEDIUM] Backing out of an issued session kept it. FIXED: it is signed out (signedOutNatively).
5. [LOW] A launch before first unlock reads no session and may show the sign-in to a signed-in person. FIXED: on
   becoming active, still on the first step with nothing issued, a session now readable closes the sign-in.
Design (Mona Lisa, approved): links stacked with no extra space; the address starts on its own line.

## Review round 3 (blind, 06:5x)
1. [SHOULD-FIX] A dead token left on the page (a session revoked while the app stayed on native tabs) was kept by the
   empty-slot rule, and the page's restore() then got a 401 and signed out the fresh native session. FIXED: the
   keychain is the source; any other value on the page is overwritten (every session the page makes it hands to the
   app). A same value changes nothing, so no reload loop. Tests: replaced, unchanged, another origin untouched.
2. [LOW-MEDIUM] With no computer at sign-in, a computer connected later never showed its match code. FIXED: the Allow
   poll reads addresses and match_code from /v1/account/me (signin.rs session_view) and moves "no computer" to the
   code screen (never the other way).
3. [LOW] The host was checked before the script ran, not inside it. FIXED: the script checks location.origin itself,
   from SignIn.pageOrigin (tested to write it as browsers do).
4. [PLAN] Sign-out order worded wrong: corrected above. Residual recorded in ContentView: a bridge sign-out lost while
   the app locks (BoardWeb.drop) would be healed back once.

## Review round 4 (blind, 07:0x)
1. [SHOULD-FIX] Writing the page's session at didFinish (rounds 1 to 3) loses a race the page always starts first:
   restore() runs in the page's inline script and has already sent the old value to /v1/account/me, so a dead old
   value still signs out the fresh native session, and a valid other account usually wins. FIXED at the root: the
   session goes in a WKUserScript at document start (main frame, origin checked inside), before restore() reads it,
   rebuilt whenever the app's session changes (accountChanges, a native sign-in). No reload at all.
2. [LOW] The reload threw away one-shot page state (a community link's nonce, a company sign-in return mid-verify).
   GONE with 1: nothing reloads.
3. [LOW] RECORDED: if the keychain cannot save a session the page made (PushRegistrar keeps it for the launch only),
   the older keychain session is put back on the next document. Converges, no loop; needs a keychain write failure.
4. [LOW] RECORDED: backing out of an issued session signs it out on the phone only; nothing asks Kosmos+ to end it,
   so a later Allow on the Mac allows a session no phone holds (the coordinator's own expiry ends it).

## Review round 5 (blind, 07:1x): no blocking defect
1. [MEDIUM-LOW] Signed out later in a launch, the next sign-in was the web page's, whose own device key makes this
   iPhone a second device on the Mac. FIXED: when the app's session goes and the native sign-in is not showing, it
   comes back from the email (SignInModel.restart). Recorded gap: the Mac's "fresh sign-in" link (?fresh=1) then
   lands on the native screen, not the page's "open my Kosmos" continuation.
2. [LOW] RECORDED: rebuilding the start scripts is removeAll then add, so a document starting in that gap gets neither
   (the tab-bar mark, the session). WebKit has no single-script remove; the page then falls back to its own copy.

## Review round 6 (blind, 07:1x)
1. [MEDIUM] After round 5's restart and a native sign-in, the web view still showed the signed-out sign-in page it
   was left on (start scripts reach only the next document), and signing in there made a second device. FIXED:
   BoardWeb.signedInNatively loads that page again (only from the native path; after the page's own sign-in it is
   mid-flow and is left alone).
2. [LOW-MEDIUM] The restart read the keychain, which a failed save leaves empty while the app is signed in, so it
   could pull a person off a company sign-in they had just finished. FIXED: keyed on the message (lastChangeSignedOut).
3. [LOW] "Sign in with your company or a passkey" after a restart could land on a native tab. FIXED: it opens the
   board's sign-in page, freshly loaded (showBoardToday).
Parity: restart clears the previous address, as the page does.

## Review round 7 (blind, 07:2x)
1. [MEDIUM-LOW] A session backed out of stayed in the page's storage (round 6's reload had stored it there), and
   the web route's restore() handed it back: the person was signed in again as the account they left. FIXED: the app
   keeps the sessions it dropped this launch; with no session held, each document's start removes a dropped one
   from the page (anything else the page holds is left), and the page showing is cleared at once (BoardWeb.forget).
2. [LOW-MEDIUM] After "This sign-in ended", the web route bounced back to the native screen (the page's 401 posted
   signed-out, and round 5's restart fired). FIXED: an ended session is dropped like one backed out of (which also
   closes round 1's residual 5), and the restart fires only on a sign-out of a session the app held.

## Review round 8 (blind, 07:3x)
1. [MEDIUM-LOW] Removing a dropped session from storage did not stop the hidden page still running with it in
   memory (its own Allow watch could open the Mac signed in as the account left). FIXED: forget() also loads a fresh
   document on the sign-in page, whose start removes it. Only ever from the native sign-in, which covers the screen.
2. [LOW] A web view rebuilt after a drop did not carry the forgotten list. FIXED: makeWebView passes it.
3. [LOW] "A session the app held" was read from the keychain only; a session it could not save is held by the
   registrar for the launch. FIXED: the registrar's session first, the keychain second.
