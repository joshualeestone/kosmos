# iosversion-7352: the iPhone app's version is 1.0, to match the App Store version it is submitted as

## Finished looks like
A build cut from main reads version 1.0 (its build number unchanged in scheme), so App Store Connect can attach it to
the 1.0 version waiting for submission (kosmos#7352).

## Why
TestFlight build 64 read 0.1.0 (64). The App Store version prepared for submission is 1.0, and Apple attaches a build
to a version only when the two match. The version comes from MARKETING_VERSION in ios/Kosmos.xcodeproj/project.pbxproj.

## Change
MARKETING_VERSION 0.1.0 -> 1.0 on all four lines (the app and its notification extension, debug and release), so the
app and extension keep one version (ios/tools/test-archive-config.sh checks that).

## Decided, and rejected
- Rejected: renaming the App Store version to 0.1.0 in App Store Connect. It would show a beta-looking number on the
  public page, and the listing draft on kosmos#7352 (issuecomment-6444393418, "What's New ... goes in at 1.0.1") already plans 1.0 then 1.0.1. Reversible either way until Josh submits.

## Weakest premise
That nothing in the app, the board or its tools gates on the iPhone app's version. Review 1 checked: the plists carry
no version keys (generated from build settings), the board has no minimum-version or what's-new logic for the phone,
and the chat-opens validator accepts "1.0 (65)". A doc line that stated 0.1.0 was missed by my first search and is
fixed (docs/phone-push-go-live.md); the remaining "0.1.0" strings are test fixtures.

## Tests
ios/tools/test-archive-config.sh: VERDICT PASS (one version across app and extension, four lines).

## Review notes
- Iteration 1: a doc line stated 0.1.0 (docs/phone-push-go-live.md); fixed. Iteration 2: only notes; converged.
