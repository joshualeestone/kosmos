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
  public page, and the listing copy already plans 1.0 then 1.0.1. Reversible either way until Josh submits.

## Weakest premise
That nothing else in the app or its tools compares against "0.1.0". Searched: the only strings left are unrelated
test fixtures (update version comparisons, a feedback payload's app field).

## Tests
ios/tools/test-archive-config.sh: VERDICT PASS (one version across app and extension, four lines).
