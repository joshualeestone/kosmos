# backfillconfirm-8768: a carried-over computer can be confirmed by two admins (kosmos#8768, board half)

## Finished looks like
A member whose computer was carried over at the switch-over (a backfill entry in escrowd's device-key history) can be enrolled by two admins through the normal devkey_enrol flow (#7116 step 2), and both readers then treat that key as admin-enrolled, so hand-over (#8733) and restore trust it. An unconfirmed backfill stays refused.

## The call (on #8768, comment 7024816852)
No new entry kind: a confirm is an `enrol` of the same key with backfill false over its live backfill entry. The format and both vectors stay; only the replay rule changes, on both sides. The key keeps its `from`; `confirmedAt` records when.

## This branch (board half)
- engine/devkeyhist.js replay: accepts exactly one confirm over a live backfill; every other repeat still refused.
- engine/devkeyhist-8768.test.js: confirm accepted and read by keyAt; unconfirmed backfill stays (control); revoke after confirm; six repeats refused against the honest confirm. Mutation control: removing the exception fails 3 tests in that file, 4 across the branch with the restore-level test.

## Not here
- The relay half: escrowd devkeyhist.rs in TWO places, append() (the AlreadyEnrolled write rule) and well_formed() (run by open_record on every start; it refuses any second enrol, so changing append() alone would make escrowd refuse its own record on restart), plus rosterops accepting devkey_enrol over a live backfill. Ice Cream Kitty's escrowd, asked on #8768.
- Deploy order: escrowd writes a confirm only with KOSMOS_ESCROWD_DEVKEY_CONFIRM=1 (relay half, off by default); set it only after this board half is served on prod. A Kosmos without it refuses a member's whole history once it holds a confirm (fail closed: restore and hand-over refused for that member until the computer updates).
- handoverseal.js (on sealkey-8733): its comment "a backfilled key never becomes admin-enrolled" goes false once both halves land; fix it with the checkSeal/checkSender test after it merges.
- A shared vector (backfill then confirm, with its head hash): pinned on both sides once the relay half exists, and the relay's test reopens the record after a confirm.
- handoverseal's checkSeal/checkSender test with a confirmed key: handoverseal.js is on Kitty's sealkey-8733, not yet on main; added after it merges. Its `backfill !== false` check needs no change.

## Weakest premise
That a confirm keeping the ORIGINAL `from` is right (a pre-confirm snapshot is then trusted under the confirmed key, and that `from` is the coordinator's recorded time). Review 1's reasoning: restore checks the key at the manifest's grant time, also the coordinator's record, so trusting only from `confirmedAt` would not stop a breached coordinator either; the manifest must still verify under the key, which only the confirmed computer holds. The alternative is one line in keyAt.

## Review
- Round 1: no blocker, no way found to make an untrusted key trusted. Fixed: the escrowd-must-uphold list states the exception; the header no longer says devkeyhist.rs already upholds it; a backfill's `at` is said to be the coordinator's; a restore-level test (backfill control, then confirmed reads backfill false; the mutation fails it); a comment on the belt-and-braces confirmedAt check.
- Round 2: no blocker. Fixed: the relay half names well_formed() as well as append(); the header wording and wrapping; restorerun's doc says backfill is the key's standing now.
- Round 3: no blocker. Fixed: the comment says escrowd refuses to START (exit 2, start_refused), not that history is lost; the deploy order is written; the handoverseal comment follow-up; the mutation count.
