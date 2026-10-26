# notifask-7222: the iPhone asks for notification permission on the Agents tab, not at launch

Card: joshualeestone/kosmos#7222. Proposal approved by Splinter 2026-10-26 12:52 CDT.

## Finished looks like
A fresh install opens on sign-in with no permission box. The first time the Agents tab shows a connected Mac's agents
(current, not marked not updating), a card at the top says "Get a buzz when an agent needs you", why in one line, and
offers "Turn on notifications" (iOS's own box) or "Not now" (hidden for good). A phone that already said yes still
registers with APNs at every launch.

## Change
- PushBridgeLogic.swift: `PushBridge.Permission`, `registersAtLaunch` (only `.allowed`) and `offersAsk` (never asked,
  agents current, not dismissed). Pure, so ios/LogicTests proves them (10 new checks).
- PushNotificationManager: `permission` (read with getNotificationSettings, never asks), `refreshPermission(registerIfAllowed:)`,
  `askDismissed` in UserDefaults, `dismissAsk()`. `requestAuthorizationAndRegister` re-reads the permission when answered.
- AppDelegate: launch calls `refreshPermission(registerIfAllowed: true)` instead of asking.
- AgentsView: takes the push manager; re-reads permission on appear and on return from the background; shows the ask as
  the list's first section. Debug-only `KOSMOS_SAMPLE_NOTIFASK=1` shows it over the sample list for screenshots.

## Rejected
- Asking right after "Allow this iPhone on your Mac" succeeds: that screen hands over to the app immediately, and a box
  over a hand-over is the same surprise in a new place.
- Re-offering after "Not now" on a timer: one ask, then iOS Settings; nagging costs more than it wins.
- A switch in the app's Settings tab: those switches are the computer's own settings (they say so); mixing in the
  phone's permission there is a separate change.

## Weakest premise
That the Agents tab is where people go first once connected. Today opens first on a cold launch when signed out; once
signed in the app opens on Agents (ios/README), so the ask is seen on the first connected launch.

## Checks
- ios/LogicTests run.sh 1272/1272 (10 new); the six other runners pass; the repo tests that read ios Swift 44/44.
- Simulator: a fresh install's first real launch shows sign-in with no permission box; the sample list shows the card
  with KOSMOS_SAMPLE_NOTIFASK=1 and not without it; light, dark and the largest text size.
