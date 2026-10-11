# kosmos#5535 E0.6 slice (c), first half: what one backup run keeps for the next

Design on #5535 (comment 6114619425): no state between runs. engine/backupstate.js keeps, per (org, member), one
owner-only file (0600 in a 0700 folder, store.ROOT/backupstate, hashed name, as backupmemberkey's file):
- job: engine/backupjob.js's state (lostEpoch, waitUntilMs, waits), cleaned on write and read;
- period: { label (ISO week), namingKey (a SECRET), bucket, index (name -> key, lockedUntilMs, memberKeyId) }.
readState: missing is empty; a link, unreadable, malformed or another (org, member)'s file is refused (never read as
empty, so nothing overwrites it). writeState refuses a state it would not read back. forPeriod reuses the period's key
and index or starts fresh; withRun folds a takeSnapshot result in (staleIndex or another bucket drops the old index).

## Decided
- The naming key is kept on disk for the period, so later runs deduplicate. It is the Mac's OWN key in its own 0600
  file, not taken from storage, so backupkeys.js's "never name new chunks from a stored wrap" rule is untouched.
- Every index entry must be filed under the period it is in (the key's 4th segment), as backupsnapshot keyProblem asks.
- Rejected: keeping state in the member key file (different lifetimes; a malformed index must never cost the key).
- Weakest premise: the index can reach 200000 entries (CHUNK_ALLOWANCE), about 30 MB of JSON, read whole each run.

## Checks
- 7 tests: round trip and modes; 10 not-ours forms refused with a control; a link refused; job fields cleaned;
  writeState refuses unreadable states and writes nothing; forPeriod same and fresh; withRun merge, staleIndex,
  another bucket, no bucket, a first run; all written and read back.
- Mutants, each red: the period-of-key check, index-needs-bucket, the naming key id check, writeState's refusal,
  staleIndex, another bucket dropping the index, the member check, the duplicate check, the link check, forPeriod's
  reuse. (One mutant line was a no-op swap after a pattern split; not counted.)
- engine.reachable.test.js excuses forPeriod and withRun by name with the reason (the guard flagged them; its run now passes 7/7).

## Review 1 (sonnet, blind, on 29d70fdda): NOT CONVERGED
- FIXED (BLOCKER): withRun read takeSnapshot's bucket null as "another bucket" and dropped the index, but null comes
  back on EVERY failure before the index is read (a bad root, the clock, a key, a context): one transient failure
  would wipe a week's index and the next runs re-upload it all. Now only staleIndex or a DIFFERENT non-null bucket drops
  it. Test (the early failure keeps it); mutant red.
- FIXED (WARNING): no way out of a refused file. discardState renames it aside (.bad-<time>), never deletes it; the
  next read is a fresh start. Test; mutant red.
- FIXED (WARNING): withRun folded unchecked rows, so writeState could throw after a finished upload. Rows are checked
  as on read (a bad one left out) and the index is capped at MAX_INDEX. Tests (a bad row, another period's row, the cap
  at 200000); mutants red.
- FIXED (WARNING): resuming a period now prunes entries sealed to another member key (#5744 rotation) or whose lock has
  ended, which takeSnapshot would refuse as a stale index. forPeriod takes { memberKeyId, nowMs }. Test; two mutants red.
- FIXED (WARNING): the header states the caller's duties: write the new period (its naming key) BEFORE the snapshot,
  write after, one run at a time per (org, member); and what a killed run costs.
- FIXED (NITs): the chmod-after-trust comment; MAX_INDEX enforced in withRun.
- MEASURED (NIT, read cost): 200000 entries = 34.6 MB; writeState 283 ms, readState 251 ms on this Mac, once each per
  run, blocking. Acceptable for an hourly run; the run may move it off the event loop later.

## Review 2 (opus, blind, on 1c3329b80): NOT CONVERGED
- Checked: every takeSnapshot return path through withRun leaves the right index (success, every early failure, every
  staleIndex, overAllowance before and after batches, a batch from another bucket, grantedPeriod, a thrown uploader,
  outlastsChunks with and without a boundary, otherBucket with and without an index; an earlier epoch's entry is always
  another member key, so pruned).
- FIXED (WARNING): an EARLIER label started fresh and threw away the later period's naming key and index, which
  happens when the coordinator grants a week ahead of this Mac's clock (grantedPeriod) and a retry reads the clock.
  Now the stored later period is returned; the caller uses the returned label. Tests (and across a year); mutant red.
- FIXED (NIT): the lock prune is documented as defensive, not as takeSnapshot's check (that one is against the
  manifest lock, which every kept row passed for its period).
- FIXED (NIT): withRun returns leftOut (not persisted), so a caller passing the wrong period shows. Test; mutant red.
- FIXED (NIT): the "would not read back" test now reaches that refusal (a 31-byte key had thrown earlier).
- Documented: discardState's .bad files are kept for a person, never removed here.
