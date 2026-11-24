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
That the report hook's turn sentences are present. A provider whose hook does not send them reads as not_yet or
maybe_read, never as read. And an automatic idle refused over a standing needs_you is not in the history, so such a
turn reads as still reading.

## Tests
- engine/msgstatus-8961.test.js (16, pure; failing control: dropping the between-turns rule fails one)
- server.msg-status-8961.test.js (5, real server + bash CLI + Windows CLI main(); control: removing the bash
  dispatch fails one)
- pinned lists updated: server.agent-token-sender-570.test.js, tools/windows-tests.js HOST_BRANCH_EXCLUDED
