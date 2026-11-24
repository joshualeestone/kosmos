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
  with neither credential). Only the sender is answered; ids and times only, never the text. In
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

## Review changes (iteration 3)
- A turn running at delivery that ends no longer stops the scan: a whole turn after it still reads as read.
- An automatic blocked (a provider stop) is a standing wait, since its hook rows are refused too.
- A reply citing another message, or sent before a held message was typed, is not its answer.
- After a placed or queued send both CLIs print the id and the --status command (a new line; "Placed with X." is unchanged).
- Both CLIs give the token hint on a not-found answer; bash anchors the error match on `{"error":`.
- The send-time residual (the row's time is when the send began) is stated in engine/msgstatus.js.
- Deferred: bash prints a not-found sentence on stdout, Windows on stderr. That is each CLI's existing convention for
  refusals (say vs ctx.err), not something this verb should change alone.

## Review changes (iteration 4)
- The because sentences use the name stripped of quotes and backslashes, as the main sentence does (tested with a
  quoted name across every because path).
- Deferred: the route's 4 MB history read per call. The summary-overdue route reads the same tail, and capping it
  here would turn a busy agent's older messages back into unknown, which is what the larger tail fixed.
- Deferred: an uncited reply keeps status answered. `cites: false` is its own field, and the sentence says it may be
  about something else; no script reads the status today.

## Review changes (iteration 5)
- Only the sender is answered (every sentence is written to the sender); the recipient gets the same refusal as anyone.
- The 4 MB read (deferred in iteration 4) is now bounded: the route reads the short tail and widens only when it is
  cut after the send. Reopened because the summary-overdue read is a sweep, not something a caller sets off.
- A held reply counts from its held-delivered time.
- `--status` after another flag is refused in words, in both CLIs.
- The bash id line anchors on the delivery object.
- Deferred: a held-delivered row with a failed state. The sweep writes that row only for a typed message
  (engine/limitqueue.js flushOnce, onDelivered after placed or unconfirmed); a failed try stays queued and is retried.

## Review changes (iteration 6)
- A session that stops after a turn started after delivery names that turn in its sentence.
- The route's two early refusals carry `sentence`, the field both CLIs print, so the board's reason reaches the caller.
- Deferred: a per-caller rate limit. Each call parses the message log, as every /api/msg send already does (mintId),
  and the wide history read now happens only for a message older than the short tail.

## Review changes (iteration 7)
- Any recorded automatic working or idle ends a standing wait (the guard refuses them while one stands, and the
  hook's idle is what clears a provider block). Iteration 3's rule had kept a cleared provider block standing forever.
- A held reply's answeredAt is when it was typed.
- The asker is matched exactly against the sender's session name.
- The id line also follows a held or unconfirmed send; `--status=<id>` is accepted first.
- The route answers a sentence for anything thrown, never an internal message.
- Deferred: a JSON escape in a board `because` would be cut by the bash sed. The sentences this module writes are
  ASCII with no quote (tested); the caller refusals are the board's existing sentences, which bash reads the same way
  on every other verb.

## Review changes (iteration 8)
- The queued-reply dating is stated as a residual beside the send-time one.
- The loop stopped at the round-8 cap (Splinter's standing rule: past round 8 only an open BLOCKER continues); none open.

## Tests
- engine/msgstatus-8961.test.js (34, pure; failing control: dropping the between-turns rule fails one)
- server.msg-status-8961.test.js (7: real server, the bash CLI and the Windows CLI main(), an enforcing board;
  control: removing the bash dispatch fails one)
- pinned lists updated: server.agent-token-sender-570.test.js, tools/windows-tests.js HOST_BRANCH_EXCLUDED
