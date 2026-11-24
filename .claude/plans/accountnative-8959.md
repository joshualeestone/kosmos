# accountnative-8959: native Kosmos+ account screen (kosmos#8959 slice B1a)

Card plan: kosmos#8959 comment 7120473038 (slices), 7121507587 (B scope), 7122016244 (B1a calls).

## Scope
Settings' "Your Kosmos+ account" row opens a native AccountView instead of the web page:
- Your computers: every row of GET /v1/account/macs (retired, waiting, refused included), words ported from
  the web page's macWhen (kosmos-relay coordinator/src/signin.html), dimmed as macStale.
- Retire: POST /v1/account/macs/remove with the name; Kosmos+ answers 409 with the code and sentence; the
  person types the code; second POST with confirm. The app never computes the code.
- Sign out: POST /v1/session/forget (x-kosmos-web: 1, as websession.rs web_request requires), then the app's
  own sign-out (PushNotificationManager.signedOutInSettings -> take(.signedOut)) and web.forget(token).
  On failure the iPhone stays signed in, says why, and offers "Sign out on this iPhone only".
- Sign out everywhere: confirm dialog, POST /v1/account/sign-out-everywhere; 200 or 401 signs out here
  (the page's rule), else keep and show the reason.
- More on Kosmos+: one row to the web account page (billing, passkeys, second step, add a computer).

## Out of scope (later slices)
B1b second step manage, B1c passkeys and new places, B2 billing/subscription/cloud machine (Safari).
The delete-account row stays on the web page (slice C).

## Tests
- ios/LogicTests/run-account.sh: logic checks (parse, words word for word, requests, retire/sign-out answers),
  in iOS CI. Negative control: a copy with the 120 s edge at 60 s fails "the two-minute edge".
- ios/KosmosUITests/AccountScreenUITests: sample run, Settings row opens the screen, rows and words,
  Retire sheet with Kosmos+'s sentence, sign-out buttons. In CI through ios/tools/ui-sample.sh (lazy-arm list).
  The test itself takes one appearance; dark shots come from a second run after `xcrun simctl ui <udid>
  appearance dark` (XCUIDevice appearance does not switch the iOS 27 simulator).

## Known gaps, decided
- No automated check drives a real sign-out through ContentView (the UI sample has no session; the sample run
  returns before any request). The decisions are in the logic suite; the wiring is checked by hand on a device.
- Sign out everywhere answered 401 (this sign-in already over) signs out here as the page does, though it does
  not prove the other sign-ins ended (a sign-out everywhere done elsewhere is the usual cause).
- The web page's per-row "Open" link (kosmos#6850) is not ported: the app opens computers from its own
  switcher, and the web page stays one row away (More on Kosmos+).
- Every answer is dropped when the sign-in changed while it was out (a sign-out answer would otherwise end
  the newer sign-in here); a change re-reads the list (accountGeneration).
- The forget route is meant for the sign-in page; a tightened web_request would break native sign-out
  (fails safe: the screen offers sign-out on this iPhone only).
- accountChangeWhy reads "... ended the sign-in (by you, or by itself)" for a deliberate press; shared
  wording, left alone.
