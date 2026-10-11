# kosmos#5805 slice 2a: `kosmos msg` to an agent out of usage is held and typed after the reset

Stacked on slice 1 (limithold-5805). From the feedback: an agent out of weekly usage kept receiving `kosmos msg`
messages marked delivered into a session that could not answer, and about two days of requests (a release go-ahead
among them) were lost. Slice 1 holds automatic lines; `kosmos msg` (agent to agent, /api/msg, messages.sendWithDelivery)
still typed straight in.

## What exists (measured)
- sendWithDelivery types with chat.deliverAsync; a could_not is logged as `refused` with no id.
- No row of the message log is ever rewritten; later events about a row are their own rows pointing back (`reaction`
  has `of`, `nudge` has `post`). Unknown kinds and fields pass rowShaped, list and /api/messages.
- Both CLIs (install/kosmos cmd_msg, tools/windows/kosmos-cli.js) print "Not delivered" and exit 1 for anything not
  placed, queued or unconfirmed, which invites a re-send.

## The call
- engine/limitqueue.js: the messages kept for one agent, in order, in one small file per agent under the store:
  `{ id, from, to, envelope, at, reset }`. add, list, remove, and `flush` for the minute sweep.
- messages.sendWithDelivery: after the envelope is built, if chat.limitHeldVerdict says the recipient is held on a
  usage limit, the message is kept (limitqueue.add), logged as a `message` row with `state: 'held'` and `heldUntil`
  (the printed reset while it is ahead, else null), and the sender gets the held shape: `{ state: could_not, held: true, heldBy: 'limit',
  heldUntil, id, at, because }`. Nothing is typed. Could not keep it: refused, as before.
- The same send again while it is held (the #4580 fold) answers with the same held receipt, not a second copy.
- The minute sweep (server.js, beside roomhold.flushReleased): for each agent with kept messages whose card reads
  released (chat.limitReleased, slice 1's test), types them in order with chat.deliverAsync. Each one typed is removed
  and logged as `{ kind: 'held-delivered', of: id, from, to, at, state }`. The first that comes back could_not stops
  that agent's run (order is kept) and stays for the next minute. A message still kept a day past its reset is dropped
  and logged as `{ kind: 'held-dropped', of: id, from, to, at }`.
- Both CLIs: a held answer prints "Held for <agent>: it is out of usage until <time>. Kosmos types it after the reset;
  do not re-send." and exits 0 (the message was accepted, as "Queued" is).
- The outbox drain (outboxOutcomeOf) counts a held answer as delivered (kept), never retries it.

## Rejected
- Typing all kept messages as one line: a go-ahead must arrive as the words its sender wrote.
- A new exit code for held: callers already treat 0 as "accepted, do not re-send", and held is exactly that.
- Rewriting the held row when it is typed: the log is append-only by design; the later row points back.

## Weakest premise
That holding a message until the reset beats typing it now into a session that cannot answer. A sender that needs a
reply sooner must send it elsewhere; the held answer tells it when, so it can.

## Residuals, stated
- The pair valve counts a held message when it is sent, as it counts any message.
- A held message whose recipient's card never reads released (a limit wording status never retires) is dropped a day
  past the reset, logged as held-dropped.
- A person's own messages are slice 2b (with a "Send now anyway" button), not this branch.

## Tests
- A message to a capped Claude agent is held: nothing typed, kept, a held row, the held receipt; the same send again is
  folded to the same id; a message to an idle agent is typed as before (control).
- The sweep types kept messages in order once the card reads released, logs held-delivered rows, keeps the rest on a
  could_not, drops one a day past its reset.
- The CLI prints the held line and exits 0 (bash CLI through a stub server; Windows CLI by its own test style).
- outboxOutcomeOf treats a held send as accepted (messages.heldAccepted, tested; the call in server.js source-asserted).

## Review 1 (opus)
- FIXED (BLOCKER): queue files are keyed by the store key, so two names with one key shared a file and one agent's
  messages could be typed to another. A name that is not its own key is not kept (refused, as any could-not-keep), and
  the sweep types only entries addressed to that exact agent (both tested).
- FIXED: a sweep still typing a backlog when the next minute started would type each message twice; one run at a time.
- FIXED: the same send again after the held copy was typed answered "held" as a raw state; it is now that delivery
  (placed, duplicate), and after a drop it goes as new. The repeat-send fold never passes "held" through.
- FIXED: held past the printed reset, the sender was promised a time already past; no time is promised then.
- FIXED: a dropped message's sender, told it was accepted, was never told otherwise; Kosmos tells it in its own pane.
- DEFERRED: the board UI shows no state for these rows. It renders no agent-to-agent message rows at all (no reader of
  /api/messages in web/), so there is no "delivered" impression to correct there.
- NIT taken: the bash CLI matches heldBy "limit" as the Windows CLI and the outbox predicate do. Not taken: a test of
  server.js's sweep wiring by running the server (a half-sandboxed server refuses to load; the predicate is tested).
