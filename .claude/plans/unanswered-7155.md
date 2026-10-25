# kosmos#7155: list the messages an agent never answered

## The card
After a long gap (out of usage, a crash, a restart) an agent has no safe way to list the inbound messages it never
answered. Ask: a one-line command, for example `kosmos inbox --unanswered --since <time>`, oldest first; ideally a
board line after a usage reset.

## Measured before building (18:25 CDT 10-25)
- `kosmos inbox [--limit N]` exists (#4784): the agent's own DIRECT thread with the person, last N, oldest first.
  It has no way to say "only what I have not answered" or "only since <time>".
- The board already decides "owes" from the same rows (`chat.dmOwes`, #4340): a person row that REACHED the agent,
  not a menu answer, newer than the agent's newest row. Kosmos's own daily-limit notice (`kosmos: true`) is not an
  answer once the pause is over (#4354).
- #5805 slice 2b already holds a person DM sent during an out-of-usage pause and types it after the reset.

## The call
Extend `kosmos inbox` (no new verb) with two flags, on the Mac CLI, the Windows CLI and the board route:
- `--unanswered`: the person's messages newer than your newest reply, oldest first. Unlike dmOwes it ALSO lists a
  message that did not reach you (marked, as inbox already marks it): that is the message this exists to recover.
  Menu answers are left out (they owe nothing, as in dmOwes). Kosmos's own notice never counts as your reply here
  (inbox already drops those rows): after a gap, the notice is not an answer.
- `--since <time>`: only messages at or after an ISO time (`2026-10-25T05:22:00Z`, `2026-10-25T05:22-05:00`, or a
  local `2026-10-25 05:22`). A time Date.parse cannot read, or one without a clock time, is refused (400 / exit 2).
- With either flag the limit keeps the OLDEST matches (after a gap the first to answer must never be the one cut),
  and a last line says how many later ones were left out and the `--since <time>` that shows them. Without a flag
  inbox keeps the newest, as before. (Challenge iteration 1 changed this from newest-kept.)
- Unanswered is timed as dmOwes times it (newest reply BY TIME, `from` equal to the agent), not by row position; a
  row with no readable time is kept by both filters rather than dropped.
- An empty answer says what was asked: "Nothing unanswered ..." / "No messages ... since ...".
- The query string only gains `&unanswered=1` / `&since=` when the flag is given, so existing callers are unchanged.

## Rejected
- A new verb (`kosmos missed`): a second way to read the same thread.
- Room posts and `kosmos msg` from other agents: a room has no "answered" fact (a post is not addressed), and the
  msg log's `owesReply` is a different rule. Recorded as the known limit; a follow-up card if wanted.
- The board line "N messages arrived while you were out": #5805 already replays a held DM after a reset, and the
  person's DMs are what this lists. Left for a follow-up rather than built blind.

## Weakest premise
That "unanswered" means "after your newest reply" rather than per message. One reply after three questions clears
all three. That is dmOwes's rule too, so the CLI and the board's "Nothing back yet." agree.

## Steps
1. server.js /api/inbox: parse `unanswered`, `since`; filter before the limit; `earlier` count; empty texts. JSON
   gains `earlier`.
2. install/kosmos cmd_inbox + help; tools/windows/kosmos-cli.js verbInbox + USAGE.
3. Tests: server.inbox-unanswered-7155.test.js, cli + windows arms in a new test file.
4. Challenge loop (cap 8), validation, PR, merge on green.

## Progress
- [x] 1  - [x] 2  - [x] 3 (10 tests; focused 88 + audits 1561 green; 3 mutants killed)  - [ ] 4
