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
  `auth_failed`, with `because` (the vendor's sentence) as evidence. It is the line Claude Code's StopFailure hook already
  writes, so no new word, and Claude agents on the Mac get it too. An incoming auto blocked already lands over a standing
  question, so the stale Question yields (step 2); auto heartbeats cannot clear it; a non-auto report can.
- **Hold** (chat.signinHeldVerdict / accountHeldVerdict): a message to an auth_failed card (any runner) is kept in the
  #5805 queue (heldBy 'limit', heldFor 'signin') instead of typed, at every #5805 site (automatic gates, kosmos msg,
  task lines, the person's DM route). limitQueueReleased refuses while signed out, so the minute sweep types the
  backlog in order once the card leaves auth_failed. Words say "signed out", never "out of usage": the receipt, the
  CLIs (both), the page's held row, the typed note, and the three nudge logs.

## Weakest premise
A scraped auth_failed that is wrong (stale scrollback the authprobe has not yet judged) now also holds messages, where
before they were typed. The page's Send now anyway is the way out, and #1930's live probe clears a stale read. The
first batch on Windows (sent before the board knows) still depends on Homer's half.

## Known gaps, stated
- The "behind" sentence ("kept from while it was out of usage") is unchanged: it is pinned in both CLIs and five tests,
  and a backlog can mix causes. A signed-out backlog's typed note does say signed out.
- A kept task line's recorded outcome (#5842, `kept-sent` / `kept-dropped`) still says "while X was out of usage".
