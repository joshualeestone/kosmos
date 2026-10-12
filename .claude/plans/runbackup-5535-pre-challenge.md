---
pre_challenge: true
method: challenge-loop
branch: runbackup-5535
diff_hash: 17b58ee83061891fca693a9f6add36ee00256c5d6bc5cfc1f8958e4ed051918b
validation: passed (Mortals: 19393 tests, 19150 pass, 0 fail, 0 cancelled, 243 skipped, hash 17b58ee83061)
subdir_audit: passed
timestamp: 2026-10-12T05:24:14Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 blind reviews: Opus, Sonnet, Opus, Sonnet, Opus, Sonnet, Opus.
**Converged:** Yes, at iteration 7 (Opus): NO NEW ISSUES. Converged at 7. Rebuilt on main after convergence: the branch's own 15 commits cherry-picked without the stack merges; its files are byte-identical to the converged tip 2f1089f76 (checked with a control that shows differences), old tip kept as tag archive/runbackup-5535-prerebuild.
**Findings:** every review's findings and dispositions are below, from the plan's Review sections.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (blind, on 02f7bd59; two must-fix, four nits, all fixed)
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

#### Iteration 2
**Reviewer model:** sonnet (blind, on fa96d1e0; one possible must-fix, five nits)
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

#### Iteration 3
**Reviewer model:** opus (blind, on 812dea64; one must-fix, one nit, both fixed)
1. MUST-FIX, MY ERROR: the end-to-end test was DELETED in the review-2 commit and the plan still claimed it. My edit
   replaced the never-throws test by slicing from it to the next named test, and the end-to-end test sat in that range.
   Nothing reported it: the count went 14 to 16 because I added three and lost one. RESTORED verbatim from fa96d1e0c.
   Lesson: after a slice edit, check the test COUNT against what was added and removed, not only the pass line.
2. NIT: the device key's `missing` (remote access never set up: a person acts) was dropped. FIXED: passed through.
Mutants after review 3 (19:25 CDT from `date`): V1 bucket dropped from the snapshot input: red (the restored end to end). V2 a snapshot id outside the context alphabet: red. V3 missing dropped: red.

#### Iteration 4
**Reviewer model:** sonnet (blind, on 692c96da; one must-fix, one nit, both fixed)
1. MUST-FIX: `took` was set before takeSnapshot, so a refused or thrown snapshot plus a failed final write still said
   "the backup ran" (review 1's fix was incomplete). FIXED: set only on result.ok === true; test for both shapes.
2. NIT: a missing device key repeated one backup-key request every run. FIXED rather than documented: the device key
   is read FIRST, locally; without one nothing is asked and nothing is written. Read again before each snapshot.
   Tests count 17 -> 18 (one replaced in place, one added).
Mutants after review 4 (19:30 CDT from `date`), each tests 18 pass 17 fail 1: W1 took set on any pass, W2 no device-key check before the key step, W3 no re-check before the snapshot.

#### Iteration 5
**Reviewer model:** opus (blind, on 2e110082; no must-fix; one nit FIXED (the keyFlags comment had been left above deviceKeyRefusal by the review-4 edit).)


#### Iteration 6
**Reviewer model:** sonnet (blind, on 99f36e39; one must-fix, one nit, both fixed)
1. MUST-FIX: refusedState told the caller to discardState a file without naming whose; after an otherPair move the
   caller could not know the pair (the pointer is not exported). FIXED: every result names the pair the run worked
   under (`pair`), set in one place (runNow over runPaired), never the key step's own copy.
2. NIT: the key step's `pair` leaked through stripState undocumented and inconsistently. FIXED by 1 (replaced or
   removed in one place) and documented. Tests 18 -> 19.
Mutants after review 6 (19:35 CDT from `date`): X1 no pair on results: red. X2 pair not moved on otherPair: red. X3 the key step's pair not removed: SURVIVES, equivalent (a result can carry the key step's pair only after it set seen.pair, which then overwrites it).

#### Iteration 7
**Reviewer model:** opus (blind, on 39c01e0c; NO NEW ISSUES. Converged at 7.)
It read every result shape as the hourly tick would and found each one actionable alone.
