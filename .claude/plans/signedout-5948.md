# signedout-5948: a signed-out agent says so, and its messages are held, not lost (kosmos#5948, board half)

## Problem (Josh, 2026-10-12)
On Windows a grok agent's sign-in lapsed. Every turn failed "Not signed in", yet each message read delivered, no
signed-out line showed, the provider was missing from `kosmos accounts`, and the messages were lost after reconnect.
Cause, from source (cited on the card): the win32 supervisor answers ok on queueing (board records placed) and drops a
failed batch; its error only reaches win32-logs; a Windows card's state is only busy/idle, so `auth_failed` (which
`accountProblemOf` keys on) never happens; and the account lists drop a folder with no credential.

## Split
Board side here. Windows supervisor half is a spec for Homer on the card (Josh 09-16: win32 engine code is built and
verified on the Windows box). The seam between them is decided and pinned here.

## This branch (step 1, 2 and the seam; step 3, accounts listing, is a second PR)
- **Seam** (status.reconcileReport): an AUTOMATIC `blocked` on `provider api (authentication_failed)` reads
  `auth_failed`, with `because` (the vendor's sentence) as evidence, ON A CARD WHOSE RUNNER IS NOT CLAUDE (the per-turn
  runners the Windows supervisor drives). It is the line Claude Code's StopFailure hook already writes, so no new word.
  An incoming auto blocked already lands over a standing question, so the stale Question yields (step 2); auto
  heartbeats cannot clear it; a non-auto report or a restart's `started` can.
- **Why not Claude (review 1):** nothing on the Mac writes the clearing report for a Claude agent. Its later heartbeats are
  automatic and refused over a standing blocked, so after /login the card would stay signed out and the hold would keep
  every message for a day. A Claude agent's StopFailure sign-in line therefore stays the plain `blocked` it was.
- **Hold** (chat.signinHeldVerdict / accountHeldVerdict): a message to an auth_failed card (any runner) is kept in the
  #5805 queue (heldBy 'limit', heldFor 'signin') instead of typed, at every #5805 site (automatic gates, kosmos msg,
  task lines, the person's DM route). limitQueueReleased refuses while signed out, so the minute sweep types the
  backlog in order once the card leaves auth_failed. Words say "signed out", never "out of usage": the receipt, the
  CLIs (both), the page's held row, the typed note, and the three nudge logs.

## Weakest premise
The release depends on the Windows supervisor clearing the line (a non-auto report after a turn that works, or a
restart's `started`). If Homer's half never clears it, a reconnected agent's messages stay held until a restart, Send
now anyway, or the queue's one-day drop. Only a REPORTED auth_failed holds (`card.stateReported`): a screen-read one has
no clearing writer on most runners, so it is typed as before. The first batch on Windows (sent before the board knows)
depends on Homer's half.

## Known gaps, stated
- A room post held for a signed-out member is recorded with the room's limit note (reset = now); the minute retry only
  looks at limit-held Claude members, so (review 2's reading, not measured here) those asks go out at the member's next
  wake or arrival rather than the next minute. Before this change they were placed and, on Windows, lost.
- The "behind" sentence ("kept from while it was out of usage") is unchanged: it is pinned in both CLIs and five tests,
  and a backlog can mix causes. A signed-out backlog's typed note does say signed out.
- A kept task line's recorded outcome (#5842, `kept-sent` / `kept-dropped`) still says "while X was out of usage".
- A PANELESS card (no pane at all) is out of scope: `panelessCard` passes no runner, so its sign-in line stays
  `blocked`. The Windows supervisor's agents are panes (win32roster), which is the case this branch is for.
