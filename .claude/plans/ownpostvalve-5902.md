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
  stranger, same-account agent, a non-boolean stamp, a missing fromKind, and the opt-out all stay held with no reopen;
  the reopen's time is the post's (engine arm).
- Mutants, each red at its own arm: no server call; operator false (the reader drops it); reopen for every external
  post (the four stay-held arms); now instead of the post's time (the engine arm, added after this mutant first
  PASSED: through recordExternal both times are one millisecond).
- Related suites 410/410: engine.reachable, messages, room-held-5800, ownroomnudge-5732, fedmsg-3311, fedseats, this file.

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
