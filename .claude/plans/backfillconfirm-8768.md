# backfillconfirm-8768: a carried-over computer can be confirmed by two admins (kosmos#8768, board half)

## Finished looks like
A member whose computer was carried over at the switch-over (a backfill entry in escrowd's device-key history) can be enrolled by two admins through the normal devkey_enrol flow (#7116 step 2), and both readers then treat that key as admin-enrolled, so hand-over (#8733) and restore trust it. An unconfirmed backfill stays refused.

## The call (on #8768, comment 7024816852)
No new entry kind: a confirm is an `enrol` of the same key with backfill false over its live backfill entry. The format and both vectors stay; only the replay rule changes, on both sides. The key keeps its `from`; `confirmedAt` records when.

## This branch (board half)
- engine/devkeyhist.js replay: accepts exactly one confirm over a live backfill; every other repeat still refused.
- engine/devkeyhist-8768.test.js: confirm accepted and read by keyAt; unconfirmed backfill stays (control); revoke after confirm; six repeats refused against the honest confirm. Mutation control: removing the exception fails 3 tests.

## Not here
- The relay half (escrowd devkeyhist.rs write rule, rosterops accepting devkey_enrol over a live backfill): Ice Cream Kitty's escrowd, asked on #8768.
- A shared vector (backfill then confirm, with its head hash): pinned on both sides once the relay half exists.
- handoverseal's checkSeal/checkSender test with a confirmed key: handoverseal.js is on Kitty's sealkey-8733, not yet on main; added after it merges. Its `backfill !== false` check needs no change.

## Weakest premise
That a confirm keeping the ORIGINAL `from` is right (a pre-confirm snapshot is then trusted under the confirmed key). The alternative, trusted only from `confirmedAt`, is one line in keyAt.
