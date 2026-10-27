# restorememberid-7181: members whose names reduce to one id no longer share nine Restored names a day

Card kosmos#7181. Built on #5536 slice 4b (branch restoreworld-5536, PR #7240); rebased onto main once that merges.

## The call
- `prepareRestoreWorld` names the new Kosmos "Restored: <member>, <date>", and `worlds.createWorld` derives its id
  with `store.safeKey`, which keeps only [a-z0-9_-]. So names only in a non-Latin script, or differing only in
  punctuation, reduced to one id and shared one pool of nine names a day: one member's restores could use up
  another's, and the refusal said "for this member" when it was not.
- `worldName` and `prepareRestoreWorld` now take an optional `memberId` (the restore request's `member`, which 4c
  has from the verified release). The name carries six hex characters of a SHA-256 of it ("Restored: Ann,
  2026-10-26 (a1b2c3)"; a second restore that day "(a1b2c3, 2)"). Hex survives safeKey, so each member has their own
  pool. The tag is a hash, never the id, and is only shown, never trusted.
- The nine-a-day refusal says "for this member" only when a member id was given; otherwise "under this name".
- Without a memberId the names are as before (the control in the tests).

## Rejected
- Giving createWorld an id separate from its name: worlds.js derives the id from the name everywhere (the card's
  option 2), a far wider change.
- Putting the member id itself in the name: it is an identifier, and the name is shown on screen.

## Weakest premise
- That 4c passes the member id. The parameter is optional so slice 4b's callers and tests are unchanged; if 4c forgets
  it, the old shared pool comes back silently. The 4c contract comment should name it.

## What would change my mind
- A member id that is not stable across one person's restores (then their own restores would not share a pool).

## Review rounds (blind)
1. (default model) W: the no-id refusal said "under this name", but the shared pool is by the reduced id (now "under
   names that read the same to Kosmos"). W: memberId optional means a silent regression if 4c forgets it: no caller
   exists yet, so the obligation is in the 4c contract comment and on #5536 (no enforcement against a call site that
   does not exist). Nits taken: the comment no longer overpromises (six hex of a hash can confirm a guessed member id;
   the name is already in the title); the module header shows the new name shape; the WIP commit is folded into one.
   Not taken: the tag on every name, even Latin ones (deliberate, uniform, reversible). Mutation arms: 3 of 3 red.

## Round 2 (blind, sonnet, 19:0x CDT 10-26)
- (1) WARNING applied: the tag was 6 hex (24 bits) and every member whose name has no Latin letters shares one tag space,
  so two of them collided at about 580 such members (1%). Now 12 hex (48 bits); the comment states the residual.
- (2) WARNING applied: a memberId given but unusable (null, '', a number, an object) silently fell back to the untagged,
  shared names, behind wording that still read right. prepareRestoreWorld now refuses it; only an absent memberId is
  "no id". Test with all five shapes plus the absent control.
- (3) NIT applied: the comment says the id is hashed byte for byte, so 4c passes one canonical form.
- (4) NIT applied: the pool is per (reduced name, tag); the comment and the refusal comment say so, and that nine a day
  is a tidiness cap, not abuse protection.
- (5) no action (the comment already concedes a guessable id can be confirmed). (6) the collision itself is not
  testable at 48 bits; the unusable-id test covers the other gap.
