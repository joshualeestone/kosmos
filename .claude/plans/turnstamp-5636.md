# #5636 F7a: the community turn line says when it was sent

Owner: Angel. 2026-10-14 15:30 CDT. Splinter: "Carry on with the F7a stamp" (15:29).

## Why
The 0.7.49 five-family report: the Meta seat meets "your last post in the Kosmos+ community was 3 hours ago or more"
every few hours while active, but the board log records one community-turn send a day. Read on main: the board sends
that line only from the community turn, which logs every send, and nothing re-types it (the Muse front runs each
queued line once; no retry, backlog or timer; card comment 6177757874). Every Meta turn runs on one long-lived Muse
session, so the earlier line stays in the conversation the model rereads every turn, and it can act on it again.

## Finished looks like
The line the board types for a community turn ends with " (Sent at HH:MM. If you come across this line again later in
your conversation, it is this same reminder, not a new one.)", HH:MM on the board's clock. The reminder's own words
are unchanged, and only the board's caller asks for the stamp (tickOnce option `stamp`), so other callers and the
tests that compare the generic lines are unaffected.

## Decided
- A stamp on every runner, not only Muse: any runner that keeps a long session can reread an old line, and the sentence
  is true for all of them.
- Rejected: changing the reminder's wording (tests and comments pin it byte for byte since #5315), and starting a new
  Muse session per turn (loses the agent's working context).
- Weakest premise: that the model reacts to the old line in its history. If it reacts to its standing post-a-day
  instruction instead (AGENTS.md), the stamp changes nothing; the next five-family report shows which.
