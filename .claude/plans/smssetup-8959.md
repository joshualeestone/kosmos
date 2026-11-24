# smssetup-8959: text-message second-step setup on the iPhone (kosmos#8959 slice A)

Plan on the card: kosmos#8959 (comment 7120473038). Parent kosmos#8952, native plan kosmos#6838.

## What changes
"Use text messages instead" on the sign-in's "Set up a second step" screen (SignInView.swift, shown only when
Kosmos+ offers texts) used to call `useWeb`, the web sign-in page in the navy Close page. It now opens two native
screens:
1. **Your mobile number**: a phone field, "Text me a code", "Use an authenticator app instead" (back to the choice).
   Sends `POST /v1/second/enrol {kind: "sms", phone}` with the enrol-only bearer (kosmos-relay second.rs enrol).
2. **Type the code**: the six-digit field, "Confirm" (the same `/v1/second/confirm` the authenticator uses),
   "Use a different number" (back to 1, the number kept).

Kosmos+ refusals show as its own sentence under the field (no country code, texts not available on this coordinator,
too many). A refusal that says start again still goes back to the email (SignIn.startsOver). The same SignInView is the
fresh sign-in sheet (ContentView.swift:317), so that path is covered too.

## Files
- SignInLogic.swift: Step `.setupPhone`, `.setupTextConfirm`; `enrolBody(phone:)`; `Enrolled.sms(sentTo:)`;
  `phoneWords`, `afterTextEnrol`, `setupCodeRefused`; `webForTexts` removed (no caller). The code line reuses
  `secondWords(kind: "sms")`.
- SignInClient.swift: `enrol(token:phone:)`.
- SignInView.swift: model `phone`, `useTexts`, `useAuthenticator`, `sendText`, `changeNumber`; `confirmSetup` takes
  either confirm step; the two screens; sample screens setupphone, setuptext, setuptexterror.
- LogicTests/main.swift: the sms answer, no tail, refusals, the body, the words, startsOver.
- KosmosUITests/TextSetupUITests.swift (2 tests), added to ios/tools/ui-sample.sh so CI runs it.

## Decided
- The number is sent as typed (trimmed). Kosmos+ normalises and refuses with a sentence; judging it on the phone too
  would be a second rule that can disagree with the server.
- The texted code's lifetime is the fixed "ten minutes" the existing second-step words use (config.rs ttl::CODE = 600),
  not a countdown from `expires_in`. Weakest premise: if ttl::CODE changes, both lines go stale together.
- No resend button: "Use a different number" then "Text me a code" sends again, and Kosmos+ rate-limits it.

## Validation
- ios/LogicTests/run.sh: PASS 2187/2187. Control: a copy without the sms parse and the trim fails the 3 new checks.
- KosmosUITests/TextSetupUITests (2 tests) on a fresh iPhone 17e, iOS 27.0 simulator: passed, once with
  `simctl ui appearance light` and once with `dark` (the script echoed the appearance it set). Shots: phone, texted
  code, refusal, light and dark.
- XCUIDevice.shared.appearance did NOT change the appearance on this simulator (two runs, "dark" shots came out
  light), so the test takes the simulator's appearance and names no appearance in its shots. That pattern is also in
  ComposerSendUITests; not changed here.
- Repo tests reading ios/ (9 files, 59 tests) and the 78 em-dash audit files: 0 fail.
