---
pre_challenge: true
method: challenge-loop
branch: memberco-5535
diff_hash: 3df0687c125bb65fd17b5f1ce4de5081bcfc08954b8b2f9122e64b28156dee69
validation: passed (Mortals full suite at 263f4c2f9, 19252 tests, 19009 pass, 0 fail, 0 cancelled, 2026-10-11 20:19 CDT; local helper skipped on that clean entry, hash 3df0687c125b)
subdir_audit: passed
timestamp: 2026-10-12T01:20:04Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 blind reviews: Opus, Sonnet, Opus, Sonnet, Opus.
**Converged:** Yes, at iteration 5 (Opus): no new issues. It checked that no path seals, records or loses state under the wrong (org, member).
**Findings:** every review's findings and dispositions are below, from the plan's Review sections.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (blind, on 56a42317; no must-fix, three nits)
1. memberKeyFor still sent lostEpoch unscoped, so wired straight to ensureMemberKey every lostEpoch would be ignored and
   backups would stop forever while the job said "it registers a new one next time". FIXED in code, not a comment:
   deps.pair; lostEpoch sent with lostFor: pair; a lostEpoch with no pair refused before any call; an answer naming
   another pair refused as otherPair with the state untouched (a wait from another pair must not back off this one);
   the key and the snapshot input carry the answer's pair.
2. The "equal is never answered" comment missed the new cause. Fixed.
3. A test comment claimed the frozen constant was checked. Reworded to what it proves.
Mutants after review 1 (19:06 CDT from `date`, engine/backupjob.test.js, node --check first, each reverted): J1 no-pair
guard removed: red. J2 lostEpoch sent without lostFor: red. J3 otherPair check removed: red. J4 member not compared:
red. J5 pair not passed to the snapshot: red. J7 otherPair checked only on ok answers (so another pair's WAIT backs
off this state): red. (A cruder J6 that broke every wait also went red; it proved less than J7, so J7 is the one cited.)

#### Iteration 2
**Reviewer model:** sonnet (blind, on f73b50c3; two must-fix, four nits)
1. MUST-FIX: a first run (no deps.pair) whose answer led to a recorded lostEpoch (a pending key, an older key) returned
   no pair, so the caller could not know which file to keep it in and the next run refused forever. FIXED: every result
   after an answer that named its pair carries `pair`, ok or not (wrapper over fromAnswer; body not re-indented).
2. MUST-FIX: the no-pair refusal had no flag. FIXED: needsPair: true.
3. NIT, accepted and not changed: a wait is not tied to a pair. The caller keeps one state per pair's file, so a wait is
   only ever read under its own pair; another pair's waiting answer is dropped (otherPair) and the caller switches, at
   most one extra backup-key round trip per run. Stated cost.
4. NIT: test gap for 1. FIXED: a first-run test for both lostEpoch paths, then a second run with the returned pair,
   plus pair on refusals and needsPair.
5. NIT: ensureMemberKey mutated the inner result. FIXED: a spread copy (and the test comment that described the old
   throw is reworded).
6. NIT: runOnce's header did not name otherPair. FIXED.
Mutants after review 2 (19:08 CDT from `date`): K1 no pair on results: red. K2 pair only on ok results: red. K3 no
needsPair flag: red. K4 back to mutating the inner result: SURVIVES, and is equivalent today (every inner return is a
fresh object, the frozen UNREADABLE included via its spread copy), so the spread is robustness with nothing to observe.

#### Iteration 3
**Reviewer model:** opus (blind, on 159e8daa; no must-fix, two nits, both fixed)
1. runOnce put the pair on result (refusals) but only on key (ok path), and the header named only the first: a caller
   following it would lose the pair after an ok key whose snapshot recorded a lostEpoch, bringing back review 2's
   must-fix. FIXED: `pair` at the top of every runOnce return after a named answer; header says so; the review-2 test
   now reads it there.
2. A present but malformed deps.pair was read as absent, switching off the otherPair check. FIXED: badPair refusal
   before any call; only undefined means a first run.
Mutants after review 3 (19:10 CDT from `date`): L1 no top pair on the ok path: red. L2 none on the refusal path: red. L3 malformed pair read as absent: red.

#### Iteration 4
**Reviewer model:** sonnet (blind, on 456016bd; no must-fix, two nits)
1. FIXED: a null deps.pair was refused as badPair, so a caller writing `state.pair || null` on a first run would be
   refused forever. null is absent now, like undefined; only a present malformed pair is badPair.
2. ACCEPTED, not changed: with deps.pair set, an ok answer that names no pair skips the otherPair check. The real
   ensureMemberKey cannot produce it (an ok answer always follows the company being known, so it always names it), and
   the run builds the manifest context from its own pair. A guard would police only stubs; 27 test calls use that shape.
   What would change my mind: a second ensureMemberKey implementation, or a wrapper that drops fields.
Mutant after review 4 (19:12 CDT from `date`): N1 null read as malformed again: red (pass 53 fail 1).

#### Iteration 5
**Reviewer model:** opus (blind, on 0dbd18bf; NO NEW ISSUES. Converged at 5. It noted the stale Change line above; fixed.)

