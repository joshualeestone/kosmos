# privacy-8654: the iPhone privacy manifest's collected data types (kosmos#8654)

## Premise checked first
The card said ios/ lacks PrivacyInfo.xcprivacy. It does not: ios/Kosmos/PrivacyInfo.xcprivacy exists since 10-27
(#7352), and the Release build carries it (Kosmos is a synchronized group). It declares UserDefaults (CA92.1) and no
collected data types.

## Change
- NSPrivacyCollectedDataTypes: the six rows of ios/store/privacy-label.md's "Data types to declare" table (EmailAddress,
  PhoneNumber, UserID, DeviceID, PurchaseHistory, OtherUserContent), each Linked true, Tracking false, purpose
  AppFunctionality, as the label states for every row.
- ios.privacy-manifest-7352.test.js reads the label table and fails when the manifest differs (types, linked, tracking,
  purposes). Red on main's manifest, with a type removed, and with one marked tracking.
- privacy-label.md UNSURE 5 settled.

## Required-reason APIs
Release build, 11-17: the binary's undefined symbols include no stat/fstat/statfs/getattrlist/mach_absolute_time
family; the only matching string is creationDate, a PHAsset's (photo date), already exempt in the test since #8045.
Xcode's privacy report (a window in Xcode) was not run.

## Weakest premise
That the label's table is right (Josh's or Mona's to rule, #718). The manifest follows it; the test keeps them together.
