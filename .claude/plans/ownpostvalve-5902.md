# ownpostvalve-5902: a person's post from their own other computer releases a held room

Card kosmos#5902 (filed by Mona Lisa in review of #5732). Branch `ownpostvalve-5902`, STACKED on
`ownroomnudge-on-5732` (#5732, unmerged), because it builds on that branch's `ownPostNudges` and
`nudgeOwnComputerPost`. Rebase onto main once #5732 merges.

## Why
roomHeldRead counts the valve from the last operator post or reopen. A post from the same person on another of their
computers arrives as an `external` row, which did not count. #5732 skips its nudge in a held room, so that post reached
no agent and the room stayed held until someone pressed Reopen on THIS computer.

## Call (decided on the card)
- YES: a post `ownPostNudges` accepts (relay-stamped `same_account` AND `fromKind === 'person'`, opt-out
  KOSMOS_OWN_ROOM_NUDGE=0) releases the room.
- Built as `messages.reopenForOwnPost(projectId, row)`: a `reopen` row (the marker reopenRoom writes: renders nothing,
  both valve readers count it), `operator: true`, `post: <external row id>`, `reason: 'own-computer'`, at the external
  row's time. Called in server.js recordExternal, synchronously, before the deferred nudge, so the nudge finds the
  room released.

## Rejected
- A second reset inside roomHeldRead reading external rows: a second place deciding "is this the person", which can
  drift from ownPostNudges.
- A note on the other computer that the room is held (the card's "no" branch): it leaves the person to press Reopen on
  a computer they are not at.
- `HELD_MEMO.delete` after the write: dead. The memo is keyed on the log's row count, and the append changes it.

## Weakest premise
`fromKind: 'person'` is said by the sending board, and engine/fedseats.js reads any kind but 'agent' as a person (an
older client that sends no kind included). So a same-account post not marked as an agent's releases the room, and a
modified client on the person's OWN other computer could keep that account's own room open. Bounded: never a stranger
(`same_account` is the relay's stamp), a reopen is not relayed onward (no loop between computers), and inbound posts
are rate-limited per minute and per day (fedseats). What would change it: the relay stamping who wrote a post.

Also: the reopen is written for EVERY such post, held or not, so like a post typed here it restarts the valve's count
in an open room too. That is deliberate (one rule: the person posting counts), not a release that happens only when
held.

## Verify
- server.ownpostvalve-5902.test.js, through server.js's REAL recordExternal (the test keeps the deps server.js hands
  fedseats.configure): CONTROL held before; released by a same-account person post, with a reopen naming it;
  stranger, same-account agent, a non-boolean stamp, and the opt-out all stay held with no reopen (a missing fromKind
  is NOT among them: fedseats makes it 'person', so it releases; see Weakest premise); the reopen's time is the post's,
  and a future time is written as now (engine arms); #5732's nudge stops held and goes ahead after a reopen (engine);
  through server.js, the deferred nudge finds the room already released.
- Mutants, each red at its own arm: no server call; operator false (the reader drops it); reopen for every external
  post (the four stay-held arms); now instead of the post's time (the engine arm, added after this mutant first
  PASSED: through recordExternal both times are one millisecond).
- Related suites (engine.reachable, messages, room-held-5800, ownroomnudge-5732, fedmsg-3311, fedseats, this file):
  412/412 at the review 3 head.

## Review 1 (opus, 2026-10-12 01:13)
- **SHOULD-FIX, taken:** the "no fromKind" arm certified the opposite of what ships (fedseats maps a missing kind to
  'person' before recordExternal). The arm is removed; the plan's weakest premise and the code comment now say an older
  client's post counts as the person's.
- **SHOULD-FIX, taken:** #5732's nudge, the reason for the change, was never run. New arm: held -> the nudge returns
  held (CONTROL); after reopenForOwnPost it does not.
- **NIT, taken:** a future `at` is written as now (it would push the valve window ahead). Tested.
- **NIT, taken:** the plan and comment say the reopen is written for every such post, held or not.
- **NITs, not taken:** aligning the project-id regex with reopenRoom's and #5732's (unreachable: the id is the board's
  own project id from the seat, and #5732 owns the other regex); line numbers in a comment (they rot).

## Review 2 (sonnet, 2026-10-12 01:14)
- **SHOULD-FIX, taken:** the order (reopen written before #5732's deferred nudge) was argued, not tested through
  server.js. New arm wraps projects.get and messages.nudgeOwnComputerPost (server.js reaches both by property) and reads
  the valve when the nudge is called: released. Mutant (reopen moved into the closure after the nudge): red at that arm.
- **NIT, taken:** the clamp's comment says it guards a hand-built row (externalPost always stamps now).
- **NITs, not taken:** the project-id regex (decided in review 1); an arm for the try/catch around the reopen (it only
  keeps a throw from reaching the seat's data handler, and nothing in reopenForOwnPost throws on a recorded row).

## Review 3 (opus, 2026-10-12 01:15)
- **SHOULD-FIX, taken:** Verify still listed the removed missing-fromKind arm; corrected, and the related count
  re-measured on this head.
- **SHOULD-FIX, taken:** two sibling comments (the gate's #2710 note and reopenRoom's) still said no agent can mint a
  reopen; both now name reopenForOwnPost and its caveat.
- **NITs, taken:** the ordering arm resets #5732's nudge gap in its finally; the tick comment is scoped.
