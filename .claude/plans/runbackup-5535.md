# runbackup-5535: one backup run (kosmos#5535 E0.6 slice (c), second half)

Stacked on four unmerged prerequisites (merge commits on this branch, dropped when each lands on main):
nkmanifest-5535 (a), devkey-5535 (b), backupstate-5535 (c, first half), memberco-5535 (the pair).

## What
engine/backuprun.js runBackup({ roots }, deps?): read the pointer (current.json, the pair the last answer named), that
pair's state, backupjob.runOnce with deps.pair, and under an ok key: forPeriod for periodOf(now), withPeriod and
writeState BEFORE the snapshot, deviceKey, takeSnapshot, withRun, once more in a granted week, then the job's state
written. One run at a time (a chain). Never throws.

## Decisions
- Roots are an INPUT. Deriving them (work Kosmos + backupsessions.sessionsFor per agent) belongs with the tick, slice (d).
- A first run (no pointer) learns its pair from the key step's answer and starts again under it, before any snapshot:
  one more backup-key request on the first run only, never a snapshot under a pair whose state was not read. Same on
  otherPair. A second change in one run stops it (pairChanged).
- A state file that does not read is never discarded here: refusedState (or retry) goes to the caller, who decides to
  set it aside and says so once.
- A pointer that does not read is learned again (it is not a secret and holds nothing but the pair).
- A granted week that does not parse: the first run's answer stands (forPeriod would throw).

## Rejected
- Keeping the job state in a separate per-computer file: lostEpoch is per member; memberco-5535 scoped it instead.
- Snapshotting on the first run under the learned pair without re-reading its state: that pair may already have a state
  file (a lost pointer), and its index and naming key would be overwritten by a fresh period.

## Weakest premise
That one extra backup-key request on a first run (and on a company move) is cheap. It is one signed request; the
member-key registration it can trigger is capped at 30 an hour by Kosmos+, and this adds at most one per run.

## Tests (engine/backuprun.test.js, real backupstate in a sandbox; key step and snapshot stand-ins except the e2e)
first run learns then runs, naming key on disk before the snapshot; same-week reuse of key and index; newPeriod once
more and never a third time (and a bad granted week); otherPair moves the pointer, flapping stops with no snapshot; a
foreign state file refused before any request and left alone; the job's wait kept between runs; no device key; a state
that cannot be written before the snapshot (no snapshot, no "ran" claim); one at a time; never throws; END TO END
through the real takeSnapshot and the real restore with no naming key given.

## Mutants
