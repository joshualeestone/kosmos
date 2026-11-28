# swplant-9307: a planted plain file at a temp name refuses the save (kosmos#9307)

## Finished looks like
engine/securewrite.js never reaches its in-place fallback because plain files were planted at its guessable temp names:
a create that fails EEXIST counts as a refusal, as a swapped name already does (#9285), and the save fails with the file
left as it was. The fallback still works for real failures, and the module's own tests reach it through one.

## The call
An EEXIST from the `wx` create of a fresh temp name throws ERR_KOSMOS_TEMP_SWAPPED (`planted: true`, the EEXIST as its
cause), so it is counted with the swaps and `swappedAttempts > 0` refuses the save. One is enough, as #9285 decided for
swaps. An EEXIST anywhere else (the chmod, the rename) is not counted.

Rejected: refusing only when all three attempts were plants. A plant at one name with two other failures would still
reach the fallback, which is the #9285 review 2 gap again.

## Tests
- New (engine/securewrite.test.js): plain files at all three names refuse the save (no in-place open, config unchanged,
  the refusal marked planted with the EEXIST kept); one plant among two EPERM failures refuses too; CONTROL: three EPERM
  failures still take the fallback and write. Fails on main ("three planted files did not refuse the save").
- Moved to EPERM, since EEXIST now refuses: securewrite.fsync-5434 (wxFails), accounts.fsync-5434 (two tests),
  store.fsync-5434 (three). The #9285 mixed-plant atomicOnly test's last attempt is now a planted refusal.
- Every test file naming EEXIST, writeSecret or securewrite (49) passes.

## Weakest premise
That nothing legitimate leaves a file at a fresh temp name. The name carries pid, thread, start time and a sequence
number, so the only route is a crashed writer with the same pid and start millisecond whose temp the reaper cannot prove
dead; that save now fails instead of rewriting in place.
