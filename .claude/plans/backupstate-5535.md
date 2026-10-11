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
