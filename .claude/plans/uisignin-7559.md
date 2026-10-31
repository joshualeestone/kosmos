# uisignin-7559: a scripted simulator sign-in for the iPhone app (kosmos#7559)

Splinter, 10-29 06:13: the Cloud phone check on build 17 could not be run because Agent1s has no Simulator window or
UI automation (#4903). Make a phone sign-in measurable here: typed by a test, headless, with xcodebuild test.

## Finished looks like
- A KosmosUITests UI test target (ios/Kosmos.xcodeproj, a synchronized folder ios/KosmosUITests) in the shared scheme's
  Test action (never Archive). SignInUITests types the email, the emailed code (from a path the runner writes) and the
  authenticator code (computed in the test, RFC 6238, CryptoKit), and asserts the board's Agents tab with no Allow step.
  TOTPTests checks the code maths against RFC 6238's own vectors, with no account, on every run.
- ios/tools/ui-signin.sh: a fresh simulator per run (deleted after), the account's otpauth from the secrets map, both
  handed to the test as TEST_RUNNER_ environment only; the emailed code from Vivienne's Gmail-history fetcher
  (~/.local/bin/kosmos-signin-code: anchor before the send, then code <address> <place> <seconds>), or by hand into a
  path the runner names. PASS, or FAIL with the step. The build and the result bundle (which can hold the environment)
  are deleted unless --keep.
- One end-to-end PASS against a cloud-only test account whose box runs staging; the result on #4903 and #7559.

## Decisions
- XCUITest over idb: committed, nothing to install, runs wherever Xcode does.
- Controls found by their words on screen (no accessibility identifiers added): it reads the sign-in as it ships, and a
  copy change fails it, which is a signal, not noise. Weakest premise: a words change in SignInView breaks the test.
- The emailed code: Vivienne's fetcher reads the hello@ inbox through the Gmail history API (search lags 8-12 min behind,
  past the code's 10 min life). The token is mailbox-wide (gmail.readonly cannot be narrowed to the test addresses); the
  fetcher limits itself to the test address and the sign-in sender and prints only the digits. Rejected: reading sent
  mail through Resend (that key reads every person's code); a fixed staging code (a coordinator change whose failure is a
  known code in production).
- test-archive-config.sh admits the .uitests bundle id (from the xcconfig, as the others); the test target carries no
  version or profile, so those counts are unchanged.

## Verify
- xcodebuild test on a fresh booted simulator: TOTPTests passes, SignInUITests skips with no account (done 06:18, exit 0).
- ios/tools/test-archive-config.sh, the LogicTests suites, Debug and Release app builds.
- End to end once the fetcher and the account exist.
- First end-to-end run (06:25 CDT 10-29, hello+test-a@, Vivienne's fetcher): the email, the emailed code (fetched in seconds, read by the test from the runner's host path), the authenticator code and the sign-in all went through in 18.6 s; it stopped at the board with "signed in, but this account has no computer connected" (test-a has no computer). That answer is now its own assertion rather than a timeout. The runner reported an Xcode log line instead of the assertion; it now names the step and the assertion.
- The result bundle is compressed: a search found neither the secret nor the email in it (the email's own control failed), so nothing can show it is free of the environment. It is deleted by default, and --keep says so.
- Review 1 (opus, blind): 0 blockers, 4 warnings, 6 nits. Fixed: the fetcher is its own background pid (killed at the end) writing straight to the code file; build-for-testing first, so the code's window starts with the run; the authenticator URL goes to the test as a 0600 file, not an environment value (an environment is copied into xcodebuild's build settings and every child); "board loaded" needs the Agents list's rows or "No agents yet" (the tab bar alone shows past sign-in, board or not), and an Allow request fails inside the wait. Nits fixed: signals clean up; authenticator URLs with other parameters are refused with a reason (tested); the archive check names the .uitests count. Nits accepted: a failed assertion's own screenshot comes from Xcode, not the step; the runtime pick takes the newest installed.
- Measured 10-29 07:2x: on this macOS, ps shows no process's environment in any form (a random marker set only in an environment was never seen, with `-axeww -o command`, `-axeww`, `-Eww -p`, `eww -p`), but it does show command lines. So the review's "ps eww" exposure does not exist here; the file still keeps the URL out of build settings and logs. Across 329 samples of every command line during a full run, the secret appeared in none. (Three earlier attempts at this check self-matched; one put the secret on a grep command line for about ten minutes; disclosed, PigeonPete rotates test-a after 08:00, Splinter's ruling.)
- Runs 2 to 5 (06:4x to 07:3x): each signed hello+test-a@ in and stopped at the board with "no computer connected", as test-a has none.
- Review 2 (sonnet, blind): 1 blocker (taken, though its premise was wrong), 1 warning (taken), 3 nits. It said the app opens on Today; it does not (AppTabs.todayTab is false outside the App Store screenshot build), so the original check was on Agents after all. Taken anyway, as a stronger check: the test opens Agents itself and waits on two names AgentsView gives only what the board's answer draws (agents-list, agents-empty, a small app change). BoardCheckTests proves it on the Debug sample board: started on Projects, the list is not found; on Agents it is. Mutation control: without the list's name it fails. (Two earlier runs of that arm pair overlapped each other; the clean one is the result.) Nits: ASCII digits only (taken).
- Cloud runs on hello+cloudrun1029@ (cloud-8c7f5984, staging 0.7.74, Kitty's account, filed as a bare base32 secret; the runner wraps it): run 1 failed on reading isSelected of a tab bar not yet drawn (fixed: exists first); run 2 met "Allow this iPhone on your Mac" at 0.5 s; run 3 found it lasts 60 s and more; run 5 tapped "Continue to the app" after 10 s and the board answered about 4 s later. The product finding: a cloud-only account's phone waits on a device ack the hosted box gives only at its own gate (a deadlock), confirmed by Kitty in the coordinator, carded #7570 (PigeonPete). The test fails, on purpose, while Continue is needed, so it goes green when #7570 is deployed. (Run 4: Xcode's test runner hung before connecting, 16 min, an infrastructure failure.)
- Review 3 (opus, blind): 0 blockers, 1 warning, 4 nits. W taken: BoardCheckTests' control looked once, the moment the tab bar drew, so a list drawn a beat late would pass it; it now holds for 3 s. Weakest premise, said here: that control's failing arm (a list that does show on Projects) has not been measured, only its passing one and the mutation (no name: fails). Nits taken: the board-did-not-answer message says whether Continue was taken; "Signed in, no computer" counts only if it lasts 5 s; the runner's message for an unreadable filed secret names the cause. Nit accepted: exists then isSelected are two reads (a harness error at worst, never a false pass). Converged: no new blocker or warning in round 3's own scope.
- After round 3: BoardCheckTests and TOTPTests pass on a fresh simulator (exit 0); the 82 repo tests that read ios/ pass; test-archive-config has no FAIL.
