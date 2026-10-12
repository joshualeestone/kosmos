# memberco-5535: ensureMemberKey names its company, and lostEpoch is scoped to it

Card: kosmos#5535 (E0.6, company backup), a prerequisite of slice (c) second half (the run).

## Why
The run keeps backupjob's state (lostEpoch, the backoff) inside backupstate's per-(org, member) file. Org and member are
only learned from Kosmos+'s backup-key answer, inside ensureMemberKey, so the run cannot know which file holds the
state it should send before the call, and ensureMemberKey's answer did not say which pair it was for. Worse, lostEpoch is
a bare per-member number: one recorded under another company or member (this Kosmos moved companies, a restored data
root) would retire THIS member's registered key whenever the epochs agreed (both 1 is the common case).

## Change
- ensureMemberKey: every answer given after the company is known carries { org, member }, ok or not. Before it (no
  answer, an unreadable answer) neither. Done in the wrapper from a `seen` holder, so the body is untouched.
- opts.lostFor { org, member }: lostEpoch is honoured only when lostFor names the company Kosmos+ answered. Without it,
  or for another pair, it is ignored, and an answer from disk says lostEpochIgnored (the existing signal).
- backupjob header: the caller's deps.ensureMemberKey adds lostFor and checks the answer's pair.

## Rejected
- Re-indenting the body into a forCompany function: 211-line diff for 4 lines of logic.
- A separate backup-key call in the run to learn the pair first: an extra round trip each run, and the pair could change
  between the two calls, which is the exact mismatch this closes.
- Honouring an unscoped lostEpoch for compatibility: no production caller exists yet (backupjob is called by nothing),
  and the unscoped form is the unsafe one.

## Weakest premise
That the run (next slice) will read the answer's pair and move its state when it differs. This slice only makes that
possible; it is written as a duty in backupjob's header.

## Tests
engine/backupmemberkey-5744.test.js: the 8 existing lostEpoch calls pass lostFor: OWN; two new tests (answers carry the
pair, including a frozen UNREADABLE copied twice; lostEpoch ignored with no/other-org/other-member/non-object lostFor,
with a scoped control that moves to epoch 2).

## Mutants (each must go red)
Measured 19:03 CDT (first written as 19:4x, a guess, corrected from `date`), each applied to the committed tree, node --check first, then reverted (pass 37 fail 1 each):
- M1 scoped always true: red. M2 member not compared: red. M3 no pair on the answer: red.
- M4 pair recorded from the raw answer before companyOf checks it: red. M5 org not compared: red.

## Review 1 (opus, blind, on 56a42317): no must-fix, three nits
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

## Review 2 (sonnet, blind, on f73b50c3): two must-fix, four nits
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
