# latemark-8016: a late copy of answered work reads as late, not as a new ask (kosmos#8016)

## What I measured first (this Mac's board, messages.jsonl, 2914 rows)
- Held room posts are never retyped: 2631 recipient outcomes read `held`, but engine/roomhold.js tells a member about
  held posts in one summary line and never types a held post later on its own (#4926's withoutStale already drops stale
  and answered ones from that line). So room posts are not a late-copy path.
- Kept `kosmos msg` messages ARE retyped later (engine/limitqueue.js, out of usage, signed out, behind earlier kept
  messages, or behind a stuck input box). Of 387 message rows, 3 were held; each has a `held-delivered` row. Each was
  typed with keptNote: `[kept for you while <reason>; sent <time>]`, which says it is late but not that the recipient
  already answered.
- Not reachable from the board: a message PLACED into a working agent's input box waits there and the agent's own CLI
  submits it after its turn (#4624). The board records `placed`; it cannot see when the agent read it.

## Built
- engine/limitqueue.js: keptNote adds `; you have written to <sender> since` when the entry carries `wroteBack`. The
  sweep sets it just before typing from a new `wroteSince` hook (sweepHooks: `wroteBackSince(messages.readLog(), e)`):
  true when the log holds a `kosmos msg` row FROM the recipient TO the sender later than the kept message's `at`. Only
  an agent's kept message (no kind) with a named sender; a person's own DM (kind 'dm') and task lines are unchanged.
  The four existing notes are byte for byte as before when the clause does not apply.
- engine/messages.js: the room left for the later note (laterRoom) now measures all four reasons, including the
  input-box note (#6774, the longest, which was missing), each with the clause and a 32-character sender (NAME_RE). Before
  this, a line just under the limit kept behind an input box could be over MAX_TEXT when typed later.

## Decided
- **Mark, do not hold back** (the card's own reason: a dropped live message is worse than a duplicate).
- **The clause, not "answered"**: the board cannot tell whether a later message answers this one; it can say that the
  recipient wrote to the sender since. The agent judges the rest.
- **The note stays at the end**, where four kinds of test pin it and the length room is measured. Weakest point of this
  choice: an agent can still read past the end.
- **Only `kosmos msg` rows count**, not room posts or reactions: a room reply to the sender is a different conversation.
- **Not built:** the CLI composer path (no board-side signal of when a placed message is read), and "cards already
  built" (the card names them; I found no path that retypes a card, so there is nothing yet to mark).

## Weakest premise
That the reporting install's late copies come through the keep queue. On this board it is the only path that retypes,
but I do not have that install's log; if its copies come from the composer path, this does not reach them.

## Tests
engine/latemark-8016.test.js (7): the clause after a reply; controls: no reply, a reply from before, a reply to another
agent and the reverse direction, an on-time message (no `[kept` at all); wroteBackSince's edges; the length room covers
the longest note. Mutants (lookup off, the old room, `>=` for `>`) each fail one test. The 8 existing files that pin the
note, the keep queue or the length limit: 148/148.
