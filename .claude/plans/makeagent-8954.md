# makeagent-8954: "Make an agent" on the empty Agents tab goes native when it can (kosmos#8954, a slice of #8952)

## Decided (with Mona Lisa, card owner, 20:34; the test corrected in review 1)
- Native New Agent only when the phone can post to its computer (board.macURL set), that computer's first-run is done
  (GET /api/first-run `done`, the board's own test), AND it has an AI account usable as the provider menu counts it
  (NewAgentPicker.usable, one shared copy). Otherwise the board's form, whose first-run setup a person not yet set up
  needs (Mona's kosmos#8783). Anything not read in 5 s is the board path, never a guess.
- The two web-only fallbacks (+ Add agent, + Add project before the computer lets the phone in) keep their wording
  here: Mona's kosmos#8957 gives every fallback one wording.

## Changed
- ios/Kosmos/NewAgentPicker.swift: emptyStateGoesNative(connected:firstRunDone:accounts:), usable, parseFirstRunDone,
  firstRunRequest, tapAnswerStands, all pure.
- ios/Kosmos/ContentView.swift: makeFirstAgent(), the empty state's createOnBoard (both reads together, 5 s, one tap at
  a time, the answer only if the computer, the account and the lock did not change).
- ios/Kosmos/AgentsView.swift: the button shows the working dots and is disabled while reading; its comment.
- ios/LogicTests/room/main.swift: 15 checks for the rule, the parser and the gate.
- ios.agents-empty-setup-8783.test.js: the source pin follows the button and the wiring.

## Verified
See the round sections below for the counts. Not done here, decided: the simulator screenshot the card's Done-when
names. board.macURL is set only by a real computer admitting the phone, which the sample board never does, so the
native path cannot be reached in the sample-board UI tests; the real-account suite needs a real paired account. The
device check belongs in Mona's TestFlight pass, which she offered.

Weakest premise: that the board's first-run `done` plus a usable account is "set up". The board itself treats an
unreadable first-run flag as done (engine/firstrun.js), and the phone agrees with it.

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

## Round 2 (sonnet, whole branch): nothing above nit; nits taken: one shared usable(); a state-none fixture (removing that clause turns it red); a pin that the busy flag resets before the gate (moving it after turns it red); this plan's early sections rewritten to the current rule. Room suite 922/922. Converged.

## After round 2, with Mona Lisa (m6303/m6305): the note her #8957 adds under the button
The decision is one shared firstAgentDecision() in ContentView, used by the tap and by checkFirstAgent(), which runs when the empty state appears and keeps its answer (firstAgentNative) only for the computer and account it was read for. AgentsView gets firstAgentGoesNative (nil until known), so a note saying the tap opens the board shows only when it is not true. Her note is wired to it after #8975 lands (rebase). Pin extended for the on-appear check and the shared decision.

## Round 3 (opus, whole branch, on the on-appear check): two should-fix, taken
- A stale "board" answer under the board overlay: closing the board page (first-run may just have been finished
  there) did not re-check, since the empty state under it does not appear anew. Now .onChange(of: todayBoard) checks
  again when the page closes, once an answer has been seen.
- The answer was never cleared: a computer or account switch now sets it to nil (and the contract says the note shows
  only when it is false, never while nil, which is "still reading").
- Nit taken: a generation counter, so an older check finishing last cannot replace a newer answer.
- Told Mona Lisa: the contract, and the "on your computer" pin (her note's words sit in ShellViews.swift, so wrapping
  the call keeps it green; she OKs narrowing it if not).
- Pins for the clear and the re-check; removing the clear turns the pin red. All 13 iOS suites, 64/64 node, build OK.

## Rebased onto #8975 (Mona Lisa's #8957, merged 04:09): her OpensOnBoardNote under Make an agent is wrapped as `if firstAgentGoesNative == false`, so it shows only when the tap goes to the board, never while reading (nil) and never when native (true). The #8783 "on your computer" pin stays green untouched (her words sit in ShellViews.swift); a new pin holds the wrap.

## Round 4 (sonnet, whole branch, after the rebase): one should-fix, taken
- The note could go stale when the computer let the phone in after the empty state appeared (the board answers through the coordinator first): the stored "board" stayed while the tap went native. Now .onChange(of: board.admissions) checks again. A drop needs no handler: it goes through start(), which sends the empty state through the waiting ring, and its appear checks again. Pinned.
- Nits: the dots label is not pinned (left); the plan's count is 15 checks in the room section (measured with grep: 14 after round 1, plus round 2's state-none case).
