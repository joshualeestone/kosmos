# kosmos#8961: kosmos msg --status <id>

## Problem
A colleague that answers a `kosmos msg` as plain text in its own window never reaches the sender. The sender sees
silence and cannot tell "it read it and did not answer" from "it never got to it".

## Call (on the card, comments 7122945292 and 7122950312)
Passive: the board says what happened to a message when the sender asks. Nothing is typed into anyone's pane, and the
recipient's words are never relayed.

## Built
- engine/msgstatus.js: status(id, {rows, history, sessionOf, asker}) and sentence(). Derived on read from two records
  that already exist (the message log and the recipient's report history), so nothing new is written and it cannot drift.
  States: answered (a message back, citing it or not), read_no_answer (a turn STARTED after delivery and ended),
  reading, maybe_read (a turn already running at delivery ended), not_yet, session_ended, not_delivered, unknown.
- engine/selfreport.js history(): rows carry `turn: 'start'|'end'` for the report hook's own turn sentences.
- server.js POST /api/msg/status: caller named as on /api/msg (agent token, else pane; refused on an enforcing board
  with neither credential). Only the sender or recipient is answered; ids and times only, never the text. In
  AGENT_TOKEN_ROUTES so a token-only agent can ask.
- install/kosmos and tools/windows/kosmos-cli.js: `kosmos msg --status <id>`, printing the board's sentence.

## Decisions
- Derived on read, not recorded on the message (the card said "record"): same answer to the sender, no write path,
  no hook change. Rejected recording because it adds a writer that has to run at every turn end and can miss one.
- A turn start counts only when the agent was between turns: Kosmos copies "answering a prompt" onto an automatic
  working row when a working agent posts to a room (server.js room post project stamp), which is mid-turn.
- POST, not GET: the CLIs already send the pane in a JSON body on /api/msg, and resolveAgentSender reads it there.

## Weakest premise
That the report hook's turn sentences are present. A provider whose hook does not send them reads as not_yet,
in_turn or maybe_read, never as read. While the agent's own needs_you or blocked stands, selfreport.record refuses the
hook's automatic working and idle rows (#900), so turns leave no marks: any wait standing at or after delivery makes
the answer unknown unless a whole turn was still seen.

## Review changes (challenge loop iteration 1)
- in_turn: a turn running at delivery and still running is not "not read yet".
- A held message counts from its held-delivered row; a held-dropped one says it was dropped.
- Names compare through the roster (a row's `to` is as typed; delivery is case-insensitive, #989).
- The route reads the longest history tail (HISTORY_MAX_BYTES).
- A cut history's first mark is not read as between turns.
- One refusal for a missing id and for another pair's message.
- The turn sentences are exported from selfreport and pinned against both hooks' text.

## Review changes (iteration 2)
- No turn mark anywhere in the kept history is unknown (a hook that sends none), not not_yet.
- A held reply is an answer only once its held-delivered row says it was typed.
- A session start or stop ends a standing wait.
- Both CLIs check the id against the board's ID_RE length; the sentence strips any quote or backslash from the name.
- Deferred: times stay ISO UTC (the readers are agents, which compare them to other board stamps, not a person).
- Deferred: the Windows exclusion has no follow-up card, as none of its sibling rows do; the reason in the row says
  what would change it (the arms run on Windows).

## Tests
- engine/msgstatus-8961.test.js (16, pure; failing control: dropping the between-turns rule fails one)
- server.msg-status-8961.test.js (5, real server + bash CLI + Windows CLI main(); control: removing the bash
  dispatch fails one)
- pinned lists updated: server.agent-token-sender-570.test.js, tools/windows-tests.js HOST_BRANCH_EXCLUDED
