# makeagent-8954: "Make an agent" on the empty Agents tab goes native when it can (kosmos#8954, a slice of #8952)

## Decided (with Mona Lisa, card owner, 20:34)
- Native New Agent only when the phone can post to its computer (board.macURL set) AND that computer reports at least
  one AI account it could make an agent on (NewAgentPicker.offerable, as the provider menu counts them). Otherwise the
  board's form, whose first-run setup a person not yet set up needs (her own kosmos#8783). Accounts that cannot be read
  are the board path too, never a guess. The accounts are read on the tap, so the answer is the computer's now.
- The two web-only fallbacks (+ Add agent, + Add project before the computer lets the phone in) keep their wording
  here: Mona's kosmos#8957 gives every fallback one wording, so a second one is not written here.

## Changed
- ios/Kosmos/NewAgentPicker.swift: emptyStateGoesNative(connected:accounts:), pure.
- ios/Kosmos/ContentView.swift: makeFirstAgent(), the empty state's createOnBoard; ios/Kosmos/AgentsView.swift comment.
- ios/LogicTests/room/main.swift: the rule, five cases (connected with an account native; CONTROL not connected; no
  account; only a signed-out account; accounts unread). Making the rule ignore the accounts turns 2 red.
- ios.agents-empty-setup-8783.test.js: the source pin follows the new wiring (makeFirstAgent; the board form when not
  connected; native only through the rule). Putting the old wiring back turns it red.

## Verified
All 13 iOS logic suites pass (run.sh and every run-*.sh); the 10 node test files that read the iPhone source pass
(64/64); the app builds for the iOS Simulator (xcodebuild, CODE_SIGNING_ALLOWED=NO).
Not done here, decided: the simulator screenshot the card's Done-when names. board.macURL is set only by a real
computer admitting the phone, which the sample board never does, so the native path cannot be reached in the
sample-board UI tests; the real-account suite (ui-signin.sh) needs a real paired account. The device check belongs
in Mona's TestFlight pass, which she offered.

Weakest premise: that "has an offerable account" is what "set up" means for the board's first-run. A computer with
an account but no other setup would now get the native form instead of the board's setup.

## Round 1 (opus, blind): three should-fix and a nit, all taken
- "Set up" was the wrong test: the board decides first-run by GET /api/first-run `done`, not by counting accounts, so
  a Mac that already has a Claude account but never finished first-run would have skipped its setup (the #8783 case).
  The rule is now: connected AND first-run done AND an account usable as the provider menu counts it (offerable, not
  "none", and the row's own offerable: the nit). First-run not read is the board path.
- A late answer could open the sheet over the lock, or for another computer or account: it now stands only if the
  board's chatEpoch is unchanged and the app is unlocked (NewAgentPicker.tapAnswerStands, pure, tested).
- Repeat taps and a silent wait: a second tap while reading is ignored, the button shows the working dots (the sweep
  suite allows no system spinner) and is disabled, and both reads together get at most 5 s (as NewAgentView's), after
  which the board's form opens.
- Tests: the room suite's section now has 14 checks (first-run done, false and unread; a row the board marks not
  offerable; the first-run parser and its CONTROL; the late-answer gate both ways). The #8783 pin follows the button
  and the new wiring. All 13 iOS logic suites pass, 64/64 node iOS-source tests, the app builds.
