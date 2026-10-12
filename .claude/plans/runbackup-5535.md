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
Measured 19:18 CDT from `date`, each on the committed tree, node --check first, reverted:
R1 no state write before the snapshot: red. R2 snapshot on a first run without learning: red. R3 no retry in a granted
week: red. R5 no one-at-a-time chain: red. R6 the job's state not kept: red. R7 an unwritable state falls through to the
"ran" sentence: red. R8 otherPair ignored: red. R9 pointer not written: red. R10 the chunk Map leaks to the caller: red.
R11 an unguarded throw: red. R4 (the i === 0 guard removed) SURVIVES and is equivalent: the loop's bound of two already
makes a third snapshot impossible, which the newPeriod test asserts (exactly two calls).

## Review 1 (opus, blind, on 02f7bd59): two must-fix, four nits, all fixed
1. MUST-FIX: a failed write AFTER the run said "the backup ran" on every path and dropped the run's flags. FIXED: the
   run's answer stands with stateNotKept / stateBecause / stateRetry beside it; "ran" only when a snapshot was taken.
2. MUST-FIX: no test for my own Rejected case (lost pointer, live file); a restart that skipped reading state survived.
   FIXED: test added (kept naming key and index reused).
3. NIT: a first run whose key step refused restarted and sent the same request again (a registration inside a
   rotation wait). FIXED: it keeps the pair and that answer's job state (only into a file with none of its own) and stops.
4. NIT: header silent on a first run whose answer names no pair. FIXED.
5. NIT: the never-throws test never reached runNow's own catch (R11 was killed by other tests). FIXED: a pointer path
   that is a folder makes writePointer throw inside runNow.
6. NIT: the granted week's write-before was unproven. FIXED: asserted on the second call, and both slots kept.
