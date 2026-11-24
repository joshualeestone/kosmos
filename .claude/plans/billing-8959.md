# kosmos#8959 slice B2: the plan line, and no money on the phone's account screen

## Measured (kosmos-relay coordinator/src/signin.html, origin/main, 2026-11-24 17:40 CST)
- `CAN_BUY_HERE = !IN_IOS_APP && !IN_ANDROID_APP` is the page's ONE SWITCH: "to sell inside an app later (in-app
  purchase, or a link-out if the store's rules and Josh allow one), change CAN_BUY_HERE and nothing else" (kosmos#718).
- Inside the apps the page hides billing (`#billing-buy`), Add a computer (`loadAddresses` returns at once), the cloud
  machine and the cloud waitlist (`loadCloud` returns at once).
- Inside the apps it still shows: the plan line `#plan-line` ("Kosmos+ · Active" when `/v1/account/me` says
  `kosmos_plus === true && (!standing || standing === "good")`), the address offer `#name-offer`, the Open my Kosmos
  buttons, and the computers and security sections (native since B1a to B1c).

## The call
- No link-out to Safari (the card's 03:52 plan said so; that plan was wrong, see the card). Josh's switch, not ours.
- Native plan line: `Account.planLine` mirrors the page's test word for word (strict JSON true; JavaScript-falsy
  standing). A section of its own at the top of the account screen, only when shown. Read with the other reads;
  a failed read keeps a line already shown, a 401 clears it, a sign-in change clears it.
- Native standing note (review 1): the server's own `standing_note` sentence, as the in-app page's `#standing-note`
  shows it (calm colour when `standing_note_calm`, error otherwise). signin.rs standing_note says the phone is where
  that sentence has to be, so a lapsed account is told why rather than seeing the plan line vanish.
- The "More on Kosmos+" footer names nothing: "Anything not on this screen is on your Kosmos+ account page." Review 6
  measured that the in-app page shows the address line only with no computer and the address offer only with no name, so
  a footer naming them was false for a named account with a computer, the commonest state.
- Next slice B3: the address choice native, then the row goes.

## Tests
- ios/LogicTests/account: 43 new checks, 98 in all (page's cases, the standing note, each status, the request). Mutants: drop the strict-true
  check (fails 1), drop the "good" arm (fails 1), calm always false (fails 1).
- AccountScreenUITests.testAccountRowOpensTheNativeScreen: the footer's words; no selling words on the built rows at
  the top and the end, and (testPasskeysAndNewPlaces) at the passkeys and new places, since a lazy List builds only
  nearby rows; the plan line's
  words and no standing note in the sample (a good plan); shots account-sign-out and account-plan, light and dark.
  The sample answers as an active plan, so the UI test proves the section renders; the parsing is LogicTests'.
- The sign-in-changed retry (read(again:)) asks the plan again too (review 1). This and readPlan's ticket and session
  checks are AccountView, which the logic suite does not compile: pinned by review, not by a test.
- Account.planAnswer decides replace / clear / keep for each status (review 3), tested for 200, 200 non-JSON, 401, 403,
  429, 503 and no answer.
- Typecheck of ios/Kosmos against the simulator SDK (0 errors; control with an injected error: 4 errors).

## Look
- The plan line is plain text in the primary colour; the web page draws it as a green pill (signin.html .plan-line).
  Deliberate for now: the native screen has no pill style, and the B3 design review can decide it.

## Weakest premise
That the plan line and the standing note are status, not selling, under #718. Review 2 named the sharper half: the
server's standing sentences include "you can buy seats for your members", "you can renew them" and "buy them again"
(signin.rs standing_note, company seats). They are statements with no button or link, they are the server's one copy,
and the in-app page shows them today, so the phone adds no new exposure. If Josh or App Review wants none of that in
the app, the change belongs in signin.rs (one sentence set for the apps), not in a filter here.
- A refused device (device_status denied) still gets the plan line: /me keeps the plan fields for it (relay#217) and the
  page shows its line unconditionally, so the phone matches the page (review 3, accepted).
- Not covered by the UI test: the standing note's look (no sample state carries one). Its parsing and colour choice are
  LogicTests'; a sample variant can come with B3 if a design review asks.
