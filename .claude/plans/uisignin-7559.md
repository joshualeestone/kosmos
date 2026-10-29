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
