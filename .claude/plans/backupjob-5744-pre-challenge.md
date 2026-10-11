---
pre_challenge: true
method: challenge-loop
branch: backupjob-5744
diff_hash: 314b91ba2f4a800db064119dbf4a8e3221d1de6c2d34290257b9a2de46dad1fb
validation: passed (Mortals full suite at de20b5acf, 19218 tests, 18975 pass, 0 fail, 0 cancelled, 2026-10-11 16:51 CDT; local helper skipped on that clean entry, hash 314b91ba2f4a)
subdir_audit: passed
timestamp: 2026-10-11T21:51:31Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind reviews: Sonnet, Opus, Sonnet.
**Converged:** Yes, at iteration 3 (Sonnet): NITs only, all taken. It traced every ensureMemberKey answer over several runs.
**Reversed decision:** review 1's "seal under an ok key with pendingEpoch" was wrong; review 2 showed such a key is always
behind Kosmos+, and it is now kept as lostEpoch and never sealed under.
**Findings:** every review's findings and dispositions are below, from the plan's Review sections.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet (blind, on cccf19b9c; NOT CONVERGED)
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

#### Iteration 2
**Reviewer model:** opus (blind, on 03a653988; NOT CONVERGED)
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

#### Iteration 3
**Reviewer model:** sonnet (blind, on ed26add75; CONVERGED)
- Traced every ensureMemberKey answer over several runs: no sequence seals under a stale key, loops without progress
  or loses lostEpoch.
- FIXED (NIT): the header's list of how a pending key sits above a registered one now includes a refused or unanswered
  registration on the lost path (the conclusion was unchanged).
- FIXED (NIT): a duplicated assertion removed.
- FIXED (NIT): now is documented as whole milliseconds (a fractional clock would drop waitUntilMs).
