# #4089: iOS signs under Stone Syndicate (864QZ69GF2) so TestFlight ships now

**Branch:** `iosteam-4089` · **Card:** kosmos#4089 (Splinter routed it 10-12 17:03; Liu Kang out of usage until 10-16).

## The call (Josh via Splinter, 2026-10-12; option A decided 17:11)
Ship TestFlight now under the active Stone Syndicate team, internal testers only, as a SEPARATE app,
`io.kosmos.app.preview`. `io.kosmos.app` is never used under Stone Syndicate. Review 3 found, and Apple's App
Transfer Criteria confirm verbatim, that "The app must have at least one version that was released to the App
Store", so an internal-TestFlight app cannot be transferred, and a bundle id is fixed once a build is uploaded.
The first plan ("transfer later") would have stranded io.kosmos.app under Stone Syndicate. When #3643 is approved
the real app is created fresh as io.kosmos.app under Kosmos Agent Manager, Inc.

## Change
- `ios/Signing.xcconfig`: `DEVELOPMENT_TEAM = 864QZ69GF2` and a new `KOSMOS_BUNDLE_ID = io.kosmos.app.preview`,
  with comments saying both are interim and why.
- `ios/Kosmos.xcodeproj/project.pbxproj`: PRODUCT_BUNDLE_IDENTIFIER = $(KOSMOS_BUNDLE_ID) (both configurations).
  Measured with -showBuildSettings: Release and Debug resolve io.kosmos.app.preview, team 864QZ69GF2. The app reads
  its id from Bundle.main at runtime.
- `ios/tools/check-ipa-entitlements.sh` takes the expected bundle id as a third argument (default io.kosmos.app);
  `ios/tools/archive.sh` reads KOSMOS_BUNDLE_ID from the xcconfig and passes it.
- `docs/phone-push-go-live.md`: an "Interim" paragraph above Step 4's done list, and the two lines that said the
  team is empty / waits on the org now describe the interim preview app and the fresh io.kosmos.app record later.

## Measured (App Store Connect API, read-only, kosmos-notarize key 43F2HU5BT8)
No app record and no identifier for io.kosmos.app on this team (control: the same query lists Mission Control
Parents). The key cannot write (403 registering the identifier). So Josh does three one-time steps (on the card).

## Weakest premise
That nothing needs push on the preview app: the coordinator allows only io.kosmos.app, so preview builds never get
push, and push arrives with the real app under Kosmos Agent Manager, Inc. with that team's APNs key. Push is not
live today in any case (the coordinator has no APNs key).

## The cut-sign sweep (review 2)
tools/test-cut-sign-preflight.sh allows the Stone Syndicate team id, name and notary key only in
tools/lib/signing-identity.sh. Xcode reads the iOS team literally from ios/Signing.xcconfig, so that file is the
sweep's one named exception (both sweeps); the docs name the team only as "the Stone Syndicate team" and point at the
file. Proven both ways: without the exception the test fails twice on Signing.xcconfig; a planted id in ios/README.md
fails both sweeps.

## Sweep rule after review 9
ios/Signing.xcconfig may name Stone Syndicate only while it builds io.kosmos.app.preview (KOSMOS_BUNDLE_ID). That is
the iOS app's own decision, so the Mac team switch in tools/lib/signing-identity.sh does not have to land with the
iOS move; once the file builds io.kosmos.app, Stone Syndicate there is a leftover and the sweep fails. Both arms are
tested on temporary copies inside the test.

## The irreversible pairing is refused by the tool (review 13)
archive.sh refuses KOSMOS_BUNDLE_ID = io.kosmos.app with the Stone Syndicate Team ID before it archives (an Admin
key would register the App ID at the archive step). archive.sh --check-config runs only the settings checks;
ios/tools/test-archive-config.sh (new, in iOS CI) shows each refusal, including that pairing; a mutant that removes
the refusal fails it.

## Checks
- archive.sh reads 864QZ69GF2 from the file (its own sed, run by hand).
- ios/tools/test-check-ipa-entitlements.sh: VERDICT PASS, with four new cases: preview build passes as preview;
  preview refused as the default id; io.kosmos.app refused as preview; preview from another team refused.
- tools/test-cut-sign-preflight.sh: 45 passed; a planted notary key in ios/Signing.xcconfig is refused (the
  exception admits the team only).
- iOS CI builds with CODE_SIGNING_ALLOWED=NO, so a team in the file changes nothing there.
