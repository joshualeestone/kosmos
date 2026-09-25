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
- The phone check covers both arms (no pay step in the app, pay step in plain Chrome), because the
  in-app signal (the TWA referrer) is reasoned, not yet observed on a device.

## Weakest part
The item names kosmos-relay's `CAN_BUY_HERE` and the Android change, which merge separately. If
the relay PR changes shape in review, this paragraph must follow it.
