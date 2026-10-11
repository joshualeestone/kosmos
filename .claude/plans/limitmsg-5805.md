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
  `{ id, from, to, envelope, at, reset, key, spill, behind? }` (reset is the drop clock; key the repeat-send key; spill
  a long message's file; behind when it was queued behind a backlog). add, list, remove, and `flush` for the minute sweep.
- messages.sendWithDelivery: after the envelope is built, if chat.limitHeldVerdict says the recipient is held on a
  usage limit, the message is kept (limitqueue.add), logged as a `message` row with `state: 'held'` and `heldUntil`
  (the printed reset while it is ahead, else null), and the sender gets the held shape: `{ state: could_not, held: true, heldBy: 'limit',
  heldUntil, id, at, because }`. Nothing is typed. Could not keep it: refused, as before.
- The same send again while it is held (the #4580 fold) answers with the same held receipt, not a second copy.
- The minute sweep (server.js, beside roomhold.flushReleased): for each agent with kept messages whose card reads
  released (chat.limitQueueReleased: slice 1's test, or no longer held at all), types them in order through the
  automatic gate (chat.deliverAutomaticAsync), at most 5 per agent per minute, each with a note that it was kept and
  when it was sent. A message sent while an agent still has kept messages goes behind them. The queue is filed under
  the card's own name. Each one typed is removed
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
- A restart between a drop and its removal can tell the sender of a dropped message twice (the record of a failed
  removal is in memory).
- A board restart between a kept message being typed and its removal from the file types it once more: the in-memory
  record of a failed removal does not survive a restart. The window is one paste.
- A message queued behind a backlog that never clears (a menu or quota hold that stays up) is dropped a day after it
  was sent, and its sender is told so in its own pane.
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

## Review 2 (sonnet)
- FIXED: the repeat-send fold looks back minutes and a hold lasts days, so a later retry kept a second copy. The same
  send (sender, text, the message it answers) already kept for that agent is that copy at any age; a cap per agent
  (now 200, with 20 per sender since review 3; one more is refused as could-not-keep). Both tested.
- FIXED: a dropped long message left its spilled file behind; it is removed with the drop (tested).
- FIXED: after an unconfirmed delivery the next kept message was typed on top of it; it waits for the next minute
  (tested).
- Covered by the first fix: two identical sends at once (the held branch is synchronous, so the second finds the first).
- NITs taken: a queue file with nothing readable left is removed; the sweep's one-run guard wraps a separate function.

## Review 3 (opus)
- FIXED: kept messages waited for slice 1's release test while fresh sends stopped being held an hour past the reset,
  so old messages were dropped while new ones arrived. The sweep releases on chat.limitQueueReleased: slice 1's test,
  or no longer held at all, the test a fresh send meets (tested).
- FIXED: in the minute between release and the sweep a new send was typed ahead of the kept backlog. While an agent
  still has kept messages a new one goes behind them, told so in its own words (tested in order).
- FIXED: one sender looping with new text each time could fill the cap and crowd out everyone else; 20 per sender,
  200 per agent (tested).
- NITs taken: the recent-send fold no longer promises a time already past; the sweep is skipped when the roster cannot
  be read (a drop then waits for a minute when its sender can be told). Not taken: the spill written before the hold
  check (removed on refuse and drop); names() pruning empty files (commented where it happens).

## Review 4 (sonnet)
- FIXED: reads (list, has, keptByKey) now see only entries addressed to that exact agent, as the sweep already did, so
  a colliding name cannot pick up another agent's backlog or kept copy (tested).
- FIXED: an entry whose reset cannot be read is dropped a day after it arrived, so the day rule holds unconditionally
  (tested).
- NIT taken: sendWithDelivery's header names the held answer and the 'held' row state. Duplicate: the pair valve
  counts held sends (stated under Residuals). Not taken: an in-memory count to skip the queue read on every send (a
  missing file is one failed open).

## Review 5 (opus)
- FIXED: review 1 refused a name that is not its own store key, so an adopted session with a capital or a dot lost the
  hold. Queue files now carry a hash of the exact name: two names with one store key each keep their own file, and
  no name is refused (tested). Reads still see only entries addressed to that exact agent.
- FIXED: a send to an agent that cannot be reached joined its leftover backlog and was answered held; it is refused as
  before (the held branch already required an addressable agent; tested).
- FIXED: a repeat of a held message that was typed folded into it even after the two had spoken since; it now follows
  #4580's rule (quiet since) and its unconfirmed wording (tested).
- DECIDED (stated in chat.limitQueueReleased): the sweep types through the automatic gate, so a question or permission
  menu on screen, or a quota hold, also keeps kept messages, and new ones behind them, waiting, where a fresh message
  would be typed straight in. A line typed into a menu answers it; waiting a minute is the lesser cost.
- NITs taken: both CLIs word a message queued behind the backlog as that (a `behind` flag; tested); the bash match no
  longer depends on two keys sitting side by side; the sweep's one-run guard frees itself after 15 minutes; the double
  filter is gone.

## Review 6 (sonnet)
- FIXED: a typed or dropped message whose removal from the file failed was typed (or its sender told) again the next
  minute. The board remembers those ids, skips them, and tries the removal again (tested with an unwritable folder).
- FIXED, found by that test's control: removing the last message deleted the file and reported success even when the
  delete failed; a failed delete is now a failed removal.
- NITs: none taken (a message queued behind takes the last entry's reset, which the receipt already treats as no time
  to promise; the bash CLI's substring match runs only on a held reply).

## Review 7 (opus)
- FIXED: a message queued behind the backlog took the backlog's reset as its drop clock, so it could be dropped minutes
  after it was sent; its day counts from when it was sent (tested).
- FIXED: the behind receipt promised "within a minute or two", which a menu or quota hold on screen can break; the
  receipt and both CLIs no longer promise a time.
- FIXED: the dropped-message notice named a cause ("stayed out of usage") that is not the only one; it says what is
  known: Kosmos kept it for a day and could not type it.
- NITs taken: the sweep checks a message is still kept just before typing it (so a run that outlived the one-run guard
  cannot type it twice); a repeat of a held message that was typed reads the delivery row before the queue; the bash
  CLI accepts a space after the colon; the flush comment sits on flush.

## Review 8 (sonnet)
- DEFERRED, by design: a held row counts as a send for the pair valve and for the sender's activity; the sender did
  send it, and no reader shows it as delivered. NITs not taken.

## Review 9 (opus)
- FIXED: a plain hold took the printed reset as its drop clock, so with the limit menu left up a day past the reset a
  message was dropped a minute after it was held; the clock is the later of the reset and now (tested).
- FIXED: a repeat of a message queued behind a backlog lost its behind wording; the kept entry remembers it (tested).
- FIXED: a run that outlived the one-run guard could type a message alongside a newer run. Each message is claimed
  while it is typed (isTyping), and only the run that set the guard frees it (tested: claimed, and a second sweep at
  the same time types nothing).
- NITs taken: the store-key test's title; the plan's entry shape. Not taken: heldUntil as UTC ISO (the agent parses
  it); the double names() read.

## Review 10 (sonnet)
- STATED (residuals): a restart between paste and removal can type a kept message once more; a message behind a
  backlog that never clears is dropped a day after it was sent, its sender told.
- Verified covered: a repeat of a typed held message after the two have spoken since goes as new (review 5's test).
- CONVENTION taken: the per-send queue read is commented where it happens. NITs not taken.

## Review 11 (opus)
- FIXED: a run that outlived the one-run guard let a newer run skip the message it held and type later ones ahead of
  it; a claimed message now holds that agent's run (tested with the clock moved past the guard).
- FIXED: a long backlog was typed against a roster read once, so an agent that hit its limit again mid-backlog got the
  rest anyway; at most 5 messages per agent per minute (tested).
- CONVENTIONS taken: the claim's comment says what it guards (another flush run), and limitqueue.js is in the #5434
  writer guard's two lists (its title no longer counts the writers, so two branches adding one do not collide).
- NIT taken: the plan's cap figure matches the code. Not taken: heldUntil in UTC; the repeated addressable call.

## Review 12 (sonnet)
- DEFERRED (checked): a held long message's spill sits in the recipient's Inbox for the hold; nothing prunes the Inbox
  (searched engine/ and server.js), and the spill is removed on refuse and drop.
- Covered by a stated residual: the in-memory record of failed removals.
- NIT taken: MAX_PER_SENDER's comment was on PER_RUN's line.

## Review 13 (opus)
- FIXED: a kept message typed a day late read as new; the sweep adds "[kept for you while you were out of usage;
  sent <time>]" (tested).
- FIXED: a late retry of a kept message met the pair valve first and could be refused while its copy was kept; the
  kept-copy check runs before the valve and before an id or spill is made (tested).
- FIXED: the queue used the name as written while the router folds case, so two spellings of one agent had two
  queues; it is filed under the resolved card's name (tested).
- CONVENTIONS taken: the held-row read rule no longer sits between the reaction rule and its comment; "The call"
  matches the code.

## Review 14 (sonnet)
- FIXED (data loss): a queue file that could not be read for a moment (a rename in progress, too many open files) was
  deleted by the sweep's listing, and a send that met the same read error wrote a one-message file over the backlog.
  Reads now tell a missing file (empty) from an unreadable one (refused): add and remove refuse rather than
  overwrite, and the listing deletes only a file it read and found nothing for (tested both ways).
- STATED (residual): a restart can repeat a drop notice.
- CONVENTION taken: the held fold reads the delivery row once.

## Review 15 (opus)
- FIXED: every refusal to keep said "out of usage, could not keep"; it now says what happened (behind or out of usage;
  the per-sender cap, the per-agent cap, or the queue not written) (tested for the sender cap).
- FIXED: a drop could fall on a message a stuck run was still typing, telling its sender "never delivered" for one
  that arrived; a claimed message is not dropped (tested).
- FIXED: nothing tested the board's sweep wiring; a source assertion pins the gate, the release test and both
  outcome rows (tested).
- FIXED: a repeat of a message typed but not removed from the file answered "held"; it answers as that delivery
  (tested with a failed removal).
- NIT taken: the queue folder is owner-only (0700). Not taken: local time in the kept note and the CLI line.

## Review 16 (sonnet)
- FIXED: a paste that never settles left its claim for good, holding that agent's queue until a restart; a claim older
  than an hour (CLAIM_STALE_MS, longer than the 15-minute run guard so review 11's wait behind a slow paste still holds)
  is stale and the message is tried again (tested; found by review 11's test deadlocking on a shared threshold). Residual: if that hung paste did land,
  the message arrives twice.
- DEFERRED: a send to a card not yet released but not held either (a dateless limit) is typed, slice 1's stated gap;
  "after a drop it goes as new" is the design (review 1), noted as a coverage question.
- NIT taken: the comments above the claim check sit on the lines they describe.
