# play-policy-doc-718: a Play Payments policy item for the Android no-purchase change

Card: kosmos #718. Owner: Johnny Cage. Asked for by Liu Kang (m684, 2026-09-25) with the Android
no-purchase change (kosmos-relay #121, merged as 3558f2e4). Scope cut by Liu Kang (m703).

## Finished means
docs/phone-push-go-live.md Step 5 has a "No purchase inside the Android app" item with exactly four
things:
1. A person (Josh) reads the current Google Play Payments policy and its exceptions before the first
   upload to any Play track, and again before the production release. No policy details are stated
   as fact.
2. It is not live until the coordinator deploy.
3. The undo: turn it off with the `CAN_BUY_HERE` switch (or revert #121) and deploy.
4. One line saying the phone checks are in kosmos-relay's android-no-purchase-718 plan, with the
   full tester script as card kosmos #3699.

## Decisions
- **One pointer line in Step 10** (the Android production bullet) for the second policy read, so
  item 1 is seen at the step where it applies; and a cross-reference in Step 5's Undo block. Both
  only point at the item, they add no content.
- **Scope cut after ten review rounds** (Liu Kang, m703). A 60-line tester script for four phone
  checks kept surfacing the next edge each round, because nobody can run it without a phone. It is
  kept on branch `play-policy-doc-718-full` (cd9a8541) and card #3699, to be corrected against a
  real device.
- **No policy summary:** policies change and differ by country; a stale summary would read as settled.

## Weakest part
The item names kosmos-relay `CAN_BUY_HERE` and #121. If that switch changes, this paragraph must
follow it; nothing checks the two against each other.
