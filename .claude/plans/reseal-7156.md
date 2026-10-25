# reseal-7156: a snapshot never names a chunk stored under another key epoch

Card kosmos#7156 (from Renet's #5536 slice 2). Option (a), with Renet's go (17:56 10-25): after a rotation, the walker seals and stores the chunks again rather than reusing earlier-epoch index entries.

## What I measured first
The defect needs an index entry under epoch N with the same memberKeyId as the epoch N+1 key. Today that cannot happen:
- `backupstate.forPeriod` hands the walker only entries whose memberKeyId is the current key's.
- Each new epoch's key is `backupkeys.newMemberKey()`.
- `backupmemberkey`'s move path renumbers only an UNREGISTERED key, and no snapshot runs under one.
- The coordinator refuses a key reused for another epoch (`member_key_reused`).

So an entry under another epoch always has another memberKeyId, and is already a stale index (`sealed to another member key`). The card's scenario is reproduced only by hand: a new test builds an index from an epoch 1 run with the same member key and snapshots under epoch 2. Before this change that snapshot succeeded and named epoch 1 chunks.

## Decided
`snapshotInner`'s index check also refuses an entry whose key's epoch segment is not `ctx.epoch` ("stored under another key epoch", staleIndex). The run then drops the index (backupstate.withRun) and seals and stores everything again under ctx.epoch. One snapshot, one epoch: restore opens it with one member key, and the read route grants one epoch per call. The comment in `keyProblem` that said an earlier-epoch entry may still restore is corrected.

## Not changed
- Renet's fetcher refuses another epoch's chunk by name (ANOTHER_EPOCH). It now never fires for a new snapshot. A snapshot made before this change keeps that honest refusal.
- No re-upload cost today, because the case cannot arise. If the invariant ever breaks, one week's upload allowance is spent once per rotation.
