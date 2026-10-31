# appstore-7352: what the iPhone app needs for App Store review

Card: kosmos#7352 (App Store prep: done, missing, Josh-only).

## Finished looks like

The repo carries everything App Store Connect needs from us for the native iPhone app: review notes written for the
native app (the reviewer signs in with the review account, as on kosmos#4090), the age rating answers, and a privacy
manifest so uploads stop failing ITMS-91053. The submit itself, pricing and the rating form are Josh's.

## Steps (built, see commits)

1. ios/store/listing.md: review notes for the native app and the review account sign-in.
2. ios/store/age-rating.md: the age rating answers.
3. ios/Kosmos/PrivacyInfo.xcprivacy: NSPrivacyAccessedAPICategoryUserDefaults with reason CA92.1, the only
   required-reason API the app uses. The project uses synchronized groups, so the file joins the app target on its own.
   The notification extension (KosmosNotice) uses none, so it needs no manifest.
4. ios.privacy-manifest-7352.test.js: fails when a new required-reason API appears in the iPhone sources undeclared.

## Verify

node --test ios.privacy-manifest-7352.test.js, plus a control (an undeclared API makes it fail). The next TestFlight
upload confirms Apple accepts it.

## Review bound

Challenge loop, two rounds then PR. Beta rule (Josh 08-19): merge on green.
