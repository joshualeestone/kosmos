# accthold-6190: #6190 part 1, an account move asks the hold before it writes

Base: origin/bulkmove-6173 (PR #6202, unmerged). Rebased onto main once #6202 lands; not merged before it.

## Call
Both account routes refuse an agent that a restart still holds BEFORE create.setAccount, using the same guard the
provider and model routes use (`removal.moveRefusal`, which answers for RESTARTING and HELD). In accountmove.start the
check runs per name inside the write loop, before this move's own hold, so it sees only earlier holds.
Rejected: refusing the whole bulk move when one agent is held (the others can move; each row says what happened).
Weakest premise: that moveRefusal's HELD arm never sees this same move's names (the hold call is after the loop today;
a reorder would refuse every agent).

## Parts 2 and 3
Not in this branch (part 2 is wording-only module state in engine/status.js; part 3 is reasoned low risk on the card).

## Review
### Round 1 (Sonnet, blind): no blocker, no warning
NITs, decided and left: (1) the route test matches the guard's source text within 400 chars (brittle by design: it is
the only coverage of the single route, and fails only when the guard is removed or moved); (2) a throwing moveRefusal
answers 400 on the single route but a refused row on the bulk one (busyRefusal already guards its own read); (3) the
refusal sentence says "account move" for a plain restart too (existing sentence in remove.js, shared by the provider and
model routes; not introduced here).
### Round 2 (Opus, blind): no blocker, no warning
CONVENTION fixed: start() failed OPEN when a caller left out moveRefusal; now it refuses (deps helper supplies a
null-answering check; new test; mutant back to fail-open turns it red). Left: the single route's throw shape (round 1 NIT
2), the source pin (round 1 NIT 1), the sentence after a finished move (existing remove.js sentence; bounded at about
25 s past the cap per the reviewer, and it says to try again).
### Round 3 (Sonnet, blind): two BLOCKERs, one WARNING, all fixed
- BLOCKER x2: the fail-closed default (round 2) broke the two other callers of accountmove.start, engine/update.test.js
  (#6173 m5496 cap test) and engine/remove.test.js (#6173 m5486). Both now pass `moveRefusal: () => null`. Lesson: grep
  every caller before changing a default; I ran only the module's own test file.
- WARNING: bulkmove-6173 was REWRITTEN under this branch (my base 05641a5e4 is no longer its ancestor), so the diff read as
  reverting #6174. Rebased onto its new tip e4daf1d7c; two conflicts in server.js resolved keeping both sides (the #6190
  guard first, then #6174's moveFromDir read; the bulk route keeps #6174's setAccount wrapper and adds moveRefusal).
- NIT fixed: a throwing hold check showed the raw error; now the same person's sentence as the missing-check case.
Re-run: accountmove-6173 19/0, update 26/0, remove 104/0 (each with --test-force-exit).
