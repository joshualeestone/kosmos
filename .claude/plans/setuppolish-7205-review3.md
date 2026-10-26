# Challenge round 3: setuppolish-7205 (head bed58378bb), blind CTO lens

Scope: the whole branch diff against origin/main, with extra attention on the round 2 commit bed58378bb.
Each claim is marked MEASURED (run on this head) or REASONED (read from source, not run).

## Round 2 findings: does each fix hold?

- [WARNING] setup-welcome-back-7205 shot had no Mac bridge: HOLDS. MEASURED: `mobile-shots.js --screens
  setup-welcome-back-7205,setup-choice-7205,setup-community-7205`: 48 shots, 0 errors, 0 overflow, exit 0. The
  welcome-back shots show Back and Get Started on the dot field (read the iphone15 light shot).
- [NIT] trailer reason: HOLDS. MEASURED: the surface gate now prints the corrected reason from bed58378bb ("the Qwen row
  of first run's Model step"), exit 0. The wrong trailer stays in 31cf509801's history; nothing reads it as current.
- [NIT] frChoiceForget catch comment: HOLDS (now "a Reload may ask again").
- [NIT] switchToConnect clears modeAskedThisLaunch: HOLDS in source (main.swift:3006). Not pinned by any test, see the
  WARNING below.
- [NIT] plan counts: HOLDS. The plan now says 50 checks and 3551 tests in both places.

## New findings

[WARNING] native-app.computer-mode-4356.test.js:77 (with native-app/main.swift:2973, 2905-2918, 3006): the branch's
Swift changes have no pin, and the existing pin on pageChoseMode's guard went vacuous when the guard was widened.
MEASURED by mutation, on scratch copies of main.swift run against the unchanged test file (the worktree untouched):
  - control, unmutated: exit 0
  - M1, guard's new clause replaced with `true` (a page answer taken at ANY time, in any mode): exit 0
  - M2, `modeAskedThisLaunch = false` removed from switchToConnect (round 2's fix): exit 0
  - M3, ensureBoardRunning's late-start undo after Connect deleted (round 1's WARNING fix): exit 0
  - M4, guard also takes `.connect`: exit 0
  - M5, positive control, `.unset || .unreadable` dropped from the guard: exit 1 (so the test can fail)
The assertion at :77 is a prefix match (`computerMode == \.unset \|\| computerMode == \.unreadable`), so it still
passes on M1 although M1 is exactly what its message warns against ("a page can flip the mode at any time"). grep:
no other test file names modeAskedThisLaunch, and only this one names pageChoseMode or ensureBoardRunning.
Scenario: a later edit (a merge, a refactor of the mode code) drops the late-start undo or the switchToConnect clear,
or loosens the guard. The suite stays green, nothing on CI drives the Mac app's start timing, and the regression
ships: a board left running on a connect computer, or any board page able to rewrite this computer's mode for the
rest of the launch. The web half is covered by render-firstrun-choice-4356.js C11 in CI; the Swift half is not.
Fix: in native-app.computer-mode-4356.test.js, anchor the guard assertion on the whole condition, e.g.
`/computerMode == \.unset \|\| computerMode == \.unreadable \|\| \(modeAskedThisLaunch && computerMode != \.connect\)\n\s+else/`;
assert `modeAskedThisLaunch = false` in body('private func switchToConnect(home: String)') and that
`modeAskedThisLaunch =` appears only there and in readLaunchComputerMode; and give ensureBoardRunning the same
two assertions loadBoard's late block has at :105-110 (the undo shape, and its index before
`guard self.boardStartGeneration == generation`). Re-run M1 to M4 to confirm each now fails.

[NIT] native-app/main.swift:2989-2993: the Connect save-failure alert is now false on a path this branch made
reachable. REASONED. Before, Connect could only be answered while the mode was unset or unreadable, so "so it will
ask again" was true: loadBoard reloads with ?mode=unset (withModeQuery) and the choice shows again. Now: Run, Welcome,
Back, Connect, and the connect write fails. computerMode is still .run (written successfully a moment ago), so
loadBoard reloads with no ?mode, the page opens Run's Welcome without Back (FR_CHOSE_HERE false), and the next launch
reads run and never asks. There is no other way to Connect from a run computer (switchToConnect's only caller is
pageChoseMode). The person is told it will ask again and it never does. Needs a write that fails just after one that
succeeded, so it is rare.
Fix: word the alert by mode, e.g. when computerMode is .run or .both: "Kosmos could not save your choice on this
computer, so it still runs agents here. ..."; or, on that path, set computerMode back to .unset before loadBoard so the
choice shows again, which keeps the existing wording true.

## Checked and found clean

- MEASURED: root unit set (web.*.test.js, native-app*.test.js, browser-checks*.test.js, fixture-discipline,
  no-name-refs; 445 files) with the dot reporter: exit 0, 3551 passes counted, 0 failures.
- MEASURED: `swiftc -typecheck native-app/main.swift` (DEVELOPER_DIR=CommandLineTools): exit 0, 0 errors.
- MEASURED: render-firstrun-choice-4356.js exit 0, "all first-screen checks passed (50)", C7 no page errors.
  render-firstrun-s6-2037.js exit 0, the Community label exactly Josh's line.
- MEASURED: kosmos_browser_check_gate exit 0; kosmos_browser_check_surface_gate exit 0.
- MEASURED: design shots, 48 of 48 for the three 7205 screens, 0 errors. One WebKit "Fetch API cannot load
  /api/settings due to access control checks" FLAG on one setup-community shot; a rerun with the sibling screen
  first-run-model (already on main) flagged the same message on 2 of its 16 shots, so it is an existing WebKit
  intermittent, not this branch.
- MEASURED: no em dashes in added lines of the diff (0; control: 283 in web/index.html).
- REASONED: ensureBoardRunning's new connect block matches reclaimStuckBoard's and loadBoard's #4356 blocks line for
  line (bump generation, clear in-flight, count the stop in stopsInFlight so Run agents here is held). A Run agents
  here while that late start is still in flight goes through loadBoard, which bumps the generation, so the late
  completion (mode now .run) is dropped by the generation guard; the two `kosmos start`s overlap, as they can today.
- REASONED: tips and the setup assistant stay off the second showing of the choice screen: tipModalOpen counts
  .frc-back and asbShows checks #fr-choice, both from #4356. asbTick reads first run closing at Back as "first run
  ended" and looks for a guide early, which is harmless.
- REASONED: the setup-welcome-back-7205 shot stages Welcome with page globals (FR_CHOSE_HERE, FR_FORCED) rather than
  walking the choice; the dot field is hosted the same way frOpen hosts it on the real path, so the shot shows what a
  person sees.

0 blockers, 1 warning, 1 nit.
