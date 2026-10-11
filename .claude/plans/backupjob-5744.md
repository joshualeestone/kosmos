# kosmos#5744 slice 3: the backup job's member-key duties (stacked on memberkey-5744, slice 2b)

Slice 2b gave ensureMemberKey. Its review left five duties for whatever runs a backup (card comments 17:29, 17:32 and
the 2b PR body): compare epochs, pass lostEpoch, seal only under an ok key, pass opts.epoch, back off on waiting.
Nothing runs a backup yet (no caller of takeSnapshot outside tests; production backup is off), so this slice builds
the step that a scheduler will call, not the scheduler.

## Pieces
1. Uploader: a refusal for another key epoch carries a structured `otherEpoch` (the integer the grant named), beside
   the existing sentence, from uploadChunks and uploadManifest. Only when the grant's answer names an integer epoch;
   a key-path mismatch with a matching answer epoch stays sentence-only (a coordinator bug, not a moved member).
2. Snapshot: takeSnapshot passes `otherEpoch` through on its failure result (chunks and manifest paths).
3. engine/backupjob.js, `memberKeyFor(state, deps)`: the key step of one run.
   - state is the job's own small record { lostEpoch?, waitUntilMs?, waits? } (the caller persists it).
   - Before waitUntilMs: answer { ok: false, waiting: true } without asking Kosmos+.
   - Calls ensureMemberKey({ lostEpoch: state.lostEpoch }) ; on ok, a key whose epoch is above state.lostEpoch clears it.
   - waiting: waitUntilMs = now + backoff (1 h, doubling, capped at 24 h; the day rule is "once a day").
   - ok: false otherwise: no snapshot this run.
4. `afterSnapshot(state, key, result)`: a result with otherEpoch > key.epoch sets state.lostEpoch = key.epoch (this
   computer's key is stale: one computer per member, design rule backup_not_member). otherEpoch < key.epoch is NOT
   lost (a coordinator answering an older epoch is a rollback, never a reason to move on); recorded as a refusal only.
5. The job passes ctx.epoch = String(key.epoch) and memberPk = key.publicKey, so "seal only under an ok key" and
   "pass opts.epoch" hold by construction (takeSnapshot already passes ctx.epoch to both uploaders).

## Decided
- No scheduler, no persistence file in this slice. Rejected: wiring a timer while production backup is off (it would
  ship a path nobody can exercise). Weakest premise: the scheduler's shape may want a different state record; it is a
  plain object, so cheap to change.
- Backoff 1 h doubling to 24 h. Rejected: retrying every run (each early retry is a round trip; after the day each send
  counts toward the registration cap, #5736).

## Checks
- Piece 1: the two #5744 uploader tests now assert otherEpoch per case (integer answer epoch only; a string epoch, a
  string other epoch and a key-path mismatch carry none). Mutants red: askSigned not passing it (2 fail), the integer
  check dropped (1 fail).
- Piece 2: backupsnapshot.test.js "#5744 slice 3" (chunks, manifest, a control with none). Each passthrough removed: red.
- Pieces 3 to 5: engine/backupjob.test.js, 7 tests at first (12 after reviews 1 and 2). Eight mutants, each red: no wait check, lostEpoch not sent, sealing
  at or below lostEpoch, any other epoch marks lost, no 24 h cap, epoch as a number, lostEpoch dropped on a refusal,
  and the ok-key gate removed (it first SURVIVED: building the snapshot input threw and read as a failed run; the test
  now requires the key step's own reason, and the mutant goes red).
- engine/backup*.test.js + engine.reachable.test.js: 356 pass, 0 fail. test-connector-verbs: 27 passed.

## Review 1 (sonnet, blind, on cccf19b9c): NOT CONVERGED
- FIXED (WARNING): a plain refusal between waits dropped `waits`, so the backoff restarted at an hour and each run
  asked again (counting toward the #5736 cap). waits is now kept until an ok key; the passed waitUntilMs is dropped.
  Test; mutant red.
- FIXED (WARNING): a stored waitUntilMs far ahead (a wrong clock when written, a restored state) held the job for the
  whole error. A wait more than BACKOFF_MAX_MS ahead is read as over. Test with a control at exactly the max; mutant red.
- FIXED (WARNING): ensureMemberKey's unreadableKeyFile and refusal (failure) and pendingEpoch and lostEpochIgnored (ok)
  were dropped. Passed through. Tests; four mutants red. (A DECISION made here, sealing under an ok key that came with
  pendingEpoch, was WRONG and is reversed in review 2.)
- FIXED (NIT): the "equal to lostEpoch" refusal is now commented as defensive (never answered when lostEpoch is honoured).
- FIXED (NIT): a test for lostEpochIgnored with an answer ABOVE lostEpoch (sealed under, state cleared).
- NO CHANGE (NIT): afterSnapshot on a state already holding lostEpoch overwrites it with key.epoch. That is right: the
  key just used is the newest this computer holds, and runOnce never passes such a state (an ok key clears it).
- NO CHANGE (NIT): the '4' string otherEpoch case guards isEpoch against a producer change; kept.

## Review 2 (opus, blind, on 03a653988): NOT CONVERGED
- FIXED (WARNING): my review-1 decision was wrong. ensureMemberKey keeps an unregistered key above a registered one
  only when a move off a lost key waits out the day, or Kosmos+ took the newer key and this computer failed to note it;
  either way the answered key is already behind Kosmos+. Checked in backupmemberkey.js (pendingEpoch at the "above"
  line; the lost path and the writeKeys failure are the only writers). Now: no snapshot, lostEpoch = the answered epoch,
  so the next call sends the pending key. This also restores lostEpoch when the caller lost the job state. Test; two
  mutants red (the branch removed, and "pending above the answer" loosened).
- FIXED (NIT): the below-lost refusal dropped waits and lostEpochIgnored; kept. Mutant red.
- FIXED (NIT): a waiting answer's pendingEpoch is passed on. Mutant red.
- FIXED (NIT): the header says only waiting is backed off and that other refusals (some re-sending a registration)
  repeat every run, so a scheduler must stay under the 30-an-hour registration cap (#5736).
- FIXED (NIT): this plan's test count.
- Process slip: three of my first round-2 mutant runs read "pass 0 fail 1", which was a file that no longer parsed (a
  multi-line pattern split by the loop), not a red test. Redone with single-line patterns and node --check first: red.

## Review 3 (sonnet, blind, on ed26add75): CONVERGED, NITs only
- Traced every ensureMemberKey answer over several runs: no sequence seals under a stale key, loops without progress
  or loses lostEpoch.
- FIXED (NIT): the header's list of how a pending key sits above a registered one now includes a refused or unanswered
  registration on the lost path (the conclusion was unchanged).
- FIXED (NIT): a duplicated assertion removed.
- FIXED (NIT): now is documented as whole milliseconds (a fractional clock would drop waitUntilMs).
