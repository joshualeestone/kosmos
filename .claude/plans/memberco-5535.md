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
