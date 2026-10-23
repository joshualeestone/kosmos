# commstyle-6487: phone notices as a message from the agent

Card: joshualeestone/kosmos#6487 (phone notifications show the agent's words and picture).

## Why now

Josh turned on Communication Notifications for the App ID io.kosmos.app in the developer portal
(2026-10-22 22:34, #admin). Read back through the App Store Connect API: io.kosmos.app (4C8YYW83WW)
lists USERNOTIFICATIONS_COMMUNICATION; io.kosmos.app.notice (8UFP5JXR28) does not, which is the control.
ios/README.md named the one change to make once that was true.

## Change

1. `ios/Kosmos.entitlements`: add `com.apple.developer.usernotifications.communication` = true.
2. `ios/KosmosNotice-Info.plist`: `KosmosMessageStyle` false -> true (NotificationService.swift reads it).
3. `ios/tools/check-ipa-entitlements.sh`: refuse a store build whose extension asks for the message style
   while the app lacks the entitlement. Test (`test-check-ipa-entitlements.sh`) gets both arms: `ext-style`
   passes, `ext-nocomm` is refused for that reason.
4. `ios/README.md`: the paragraph now describes the state, not the to-do.

Outside the repo (done, not in the diff): the capability change invalidated the "Kosmos App Store" profile
(96XK73W6X5, INVALID). Deleted it and made a fresh one with the same name (6AH9823R7P, ACTIVE, carries the
communication entitlement), installed on this Mac; the invalid copy is set aside, not deleted from disk.
The team's profile list (App Store Connect API, 2026-10-22 22:36) held no other profile for io.kosmos.app, so there
was no development or ad hoc profile to remake.

## Decided

- The entitlement goes on the app only, not the extension: the README's plan said so, and the extension's
  App ID does not hold the capability, so asking there would fail signing.
- Kept the profile name "Kosmos App Store" so KOSMOS_IOS_PROFILE settings elsewhere keep working.
- Weakest premise: that iOS shows the message style with the entitlement on the app alone. The signed build
  proves the entitlement is present; only a notice on a real phone proves the style shows.

## Validation

- `ios/tools/archive.sh --build 9999` with KOSMOS_IOS_PROFILE='Kosmos App Store' and
  KOSMOS_IOS_NOTICE_PROFILE='Kosmos Notice App Store': archive and export succeeded; check-ipa-entitlements
  VERDICT: PASS including "message-style notices, and the app holds Communication Notifications". Not uploaded.
- `ios/LogicTests/run.sh`: 512/512. `ios/tools/test-check-ipa-entitlements.sh`: PASS.

## Done means

A notice on Josh's iPhone shown as a message from the agent (picture and name), from a TestFlight build
carrying this change. Merge waits on the 0.7.64 HOLD.
