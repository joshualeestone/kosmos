# play-policy-doc-718: a Play Payments policy step before the first Play submission

Card: kosmos #718. Owner: Johnny Cage. Asked for by Liu Kang (m684, 2026-09-25) with the Android
no-purchase change (kosmos-relay android-no-purchase-718).

## Finished means
- docs/phone-push-go-live.md Step 5 has a "Before the first Play submission" item: a person (Josh)
  reads the current Google Play Payments policy and its exceptions.
- The doc states no policy details as fact; it describes what the app does so the reader can check
  it, names the decision and who can overrule it, and gives a phone check for both arms.

## Decisions
- No policy summary in the doc: policies change and differ by country, and a stale summary would
  read as settled. Liu Kang asked for exactly this.
- The phone check covers both arms (no pay step in the app, pay step in plain Chrome), and both ways
  the app runs today (a sideloaded upload-key build, verified; a Play install, which falls back to a
  browser-bar Custom Tab until Play's signing key is in assetlinks.json), because the in-app signal
  (the TWA referrer) is reasoned, not yet observed on a device. It names who can run it, since
  Mortals has no phone.

- **Ordered by when each check can run** (challenge-loop round 2): the Android behaviour is live
  only after the relay PR merges and the coordinator is deployed; a sideload check means something
  only once assetlinks.json is live; a Play-install check can only follow the first Play upload and
  gates the production release. The web arm is checked in a new Chrome tab, since "Open in Chrome"
  carries the app's memory along.

## Weakest part
The item names kosmos-relay's `CAN_BUY_HERE` and the Android change, which merge separately. If
the relay PR changes shape in review, this paragraph must follow it.
