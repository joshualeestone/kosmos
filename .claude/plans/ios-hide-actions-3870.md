# ios-hide-actions-3870: no Approve/Deny on iOS notifications for the first submission

Card: kosmos #3870 (part of #718). Decision by Liu Kang, reversible, Josh can overrule.

## Finished looks like
- The iOS app registers the AGENT_PERMISSION category with no action buttons, so a
  notification offers only the plain tap, which opens the agent (#718 push-tap).
- No code path handles APPROVE_ACTION / DENY_ACTION any more.
- ios/LogicTests proves no category registers an action, and fails when one is put back.

## Approach
- New `ios/Kosmos/NotificationCategories.swift` (UserNotifications only, no UIKit) builds the
  category set, so the macOS-compiled LogicTests can inspect it. PushNotificationManager
  registers `NotificationCategories.all()`.
- Kept the category itself registered (rejected: registering none) so a push whose payload
  names AGENT_PERMISSION still matches a known category; with no actions it behaves as a
  plain notification.

## Validation
- `bash ios/LogicTests/run.sh`: VERDICT: PASS 226/226.
- Negative control: a copy with an APPROVE_ACTION button restored fails 1 of 226.
- `swiftc -typecheck` of ios/Kosmos/*.swift against the iPhoneSimulator 26.5 SDK: clean.

## Weakest part
Not run on a device or simulator (no iOS runtime on the build box); the proof that the
lock screen shows no buttons is that no action is registered, not an observed notification.

## Effect on App Review 4.2 (a repackaged website)
Lock-screen Approve/Deny were one of the native features that argue against 4.2. Hiding
them weakens that case: what remains is APNs push with a tap that opens the agent, the
offline page, pull to refresh, Safari for outside links, and Face ID (built, switched off).
ios/store/README.md (the #718 listing PR) lists 4.2 among the things Josh decides before
submission; this PR should say so in its description too.
