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
Mutants after review 1 (19:20 CDT from `date`), all red (pass 13 fail 1 each): S1 the restart skips reading state (the reviewer's survivor), S2 always "ran", S3 the final write drops the run's flags, S4 a refused first run restarts, S5 it keeps no job state, S6 runNow's catch rethrows, S7 took never set.

## Review 2 (sonnet, blind, on fa96d1e0): one possible must-fix, five nits
1. FIXED: a pointer write that threw fell to the generic "could not run", and a refused first run's backoff was lost
   with it. Now its own sentence (a copy of a frozen refusal). Not "keep the backoff anyway": with no pointer the next
   run cannot find it. If it repeats, it is one backup-key request an hour against a cap of 30.
2. FIXED: an ok key whose answer named no pair said "learned ... starts again" and leaked learnPair. Now a fixed true
   refusal; learnPair is stripped from every result.
3. FIXED: lostEpochIgnored (on runOnce's key) and leftOut (on the stateNotKept path) now reach the caller.
4. REJECTED: "a failing granted-week pass hides the first week's snapshot". A newPeriod answer is ok: false with no
   manifest granted (backupsnapshot: a run that crosses the week stops as newPeriod), so the first pass took no
   snapshot to hide.
5. ACCEPTED (stated in Decisions): the restart after learning the pair sends one more backup-key request.
6. ACCEPTED: under a LOST pointer, the first request is sent before the file's own lostEpoch or wait is read, and a
   refused answer's job state is dropped in favour of the file's. Costs one request once per lost pointer, which is a
   damaged data root, not a normal path.
Mutants after review 2 (19:23 CDT from `date`): U1 pointer write unguarded: red. U2 the unnamed pair says
"learned": red. U4 key flags dropped: red. U5b the shared frozen refusal returned on the learn path: red (U5 first hit the
otherPair return, which no test reaches with a failing pointer: same code, said here rather than claimed). U6 runNow's
catch rethrows: red. U3 (learnPair not stripped) SURVIVES and is equivalent: every learnPair result now goes to the
restart or to the unnamed-pair sentence, so no path hands one to stripState.

## Review 3 (opus, blind, on 812dea64): one must-fix, one nit, both fixed
1. MUST-FIX, MY ERROR: the end-to-end test was DELETED in the review-2 commit and the plan still claimed it. My edit
   replaced the never-throws test by slicing from it to the next named test, and the end-to-end test sat in that range.
   Nothing reported it: the count went 14 to 16 because I added three and lost one. RESTORED verbatim from fa96d1e0c.
   Lesson: after a slice edit, check the test COUNT against what was added and removed, not only the pass line.
2. NIT: the device key's `missing` (remote access never set up: a person acts) was dropped. FIXED: passed through.
Mutants after review 3 (19:25 CDT from `date`): V1 bucket dropped from the snapshot input: red (the restored end to end). V2 a snapshot id outside the context alphabet: red. V3 missing dropped: red.

## Full-suite gates checked by hand before review 4 (memory: they run only in the full suite)
- engine.reachable.test.js: runBackup is tested and reachable from nowhere until the tick. Excused there with its
  caller named (slice (d)), as its siblings are. readPointer and newSnapshotId were exported for nothing; unexported.
- tools/test-connector-verbs.sh: backuprun.js is a new macRequest caller. Re-decided in the file: it signs nothing of
  its own (backupupload's grant routes and backupmemberkey's, both decided). 27/27 after.

## Review 4 (sonnet, blind, on 692c96da): one must-fix, one nit, both fixed
1. MUST-FIX: `took` was set before takeSnapshot, so a refused or thrown snapshot plus a failed final write still said
   "the backup ran" (review 1's fix was incomplete). FIXED: set only on result.ok === true; test for both shapes.
2. NIT: a missing device key repeated one backup-key request every run. FIXED rather than documented: the device key
   is read FIRST, locally; without one nothing is asked and nothing is written. Read again before each snapshot.
   Tests count 17 -> 18 (one replaced in place, one added).
