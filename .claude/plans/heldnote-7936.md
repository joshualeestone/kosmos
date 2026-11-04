# heldnote-7936: a message held behind an input box tells its sender early and drops sooner

Card: kosmos#7936 (feedback collector, 11-04 06:20; Splinter assigned it). Two items.

## What finished looks like

1. A `kosmos msg` kept because its recipient's input box held text not yet sent: its sender is told within minutes
   that it is still held, why, and when it drops; and it drops after 2 hours, not a day.
2. The unanswered list's header names `--in-reply-to`, the flag `kosmos post` takes.

## Measured before building

- The sender already gets a receipt at send time: "held: casey's input box holds text not yet sent; Kosmos types it
  once the box is clear" (engine/messages.js heldReceipt). Nothing after that until the minute sweep
  (engine/limitqueue.js flushOnce) dropped it DROP_AFTER_MS (a day) past its `reset` (its arrival, for an input hold),
  and tellHeldDropped told the sender "kept it for a day". #7212 writes a long input hold to the board log only.
- server.js's unanswered header said "no post of yours cites it by id with --reply-to"; `kosmos post` takes
  `--in-reply-to` (install/kosmos post usage). `--reply-to` is `kosmos community comment`'s flag.

## Change

- engine/limitqueue.js: `INPUT_DROP_AFTER_MS` (2 h, the room's own HELD_TELL_MAX_MS), `STILL_HELD_TELL_MS` (10 min),
  `STILL_RETRY_MS` (15 min). Per agent, the sweep asks the hooks' `boxIsReason` (queue released on usage and sign-in, and
  the box reads text); `dropAfter(e, limited)` is 2 h for a `kosmos msg` kept for the box (input: true, no kind) while the
  box is the reason, a day otherwise. The 2 hours and the 10-minute notice count from the later of the message's reset and
  the last sweep at which the box was not the only reason (or the board's first sweep for that agent). `onStillHeld` is
  called after the sweep's typing, for messages still kept, once (retried no sooner than 15 min if it did not land).
- engine/messages.js: `tellHeldStill` types the notice into the sender's pane; `tellHeldDropped(entry, roster, short)`
  says "for two hours while its input box held text not yet sent" when the 2-hour rule dropped it; the receipts (direct,
  and kept behind such a message) add "or, after 2 hours with the box still full, drops it and tells you".
- install/kosmos and tools/windows/kosmos-cli.js: the CLI's two input-hold lines say the same.
- server.js: the unanswered header (and a comment) name `--in-reply-to`.

## Decided

- 2 hours, not minutes: a person may be part way through a message in that box. Rejected: telling the person, because
  the board log already records a long input hold (#7212).
- Only a `kosmos msg` is shortened. A task line (its own task-conversation notices) and a person's own message from
  the screen (its row shows held) keep the day.
- Weakest premise: that two hours is long enough for a box a person is genuinely using. A person typing for over two
  hours in an agent's box loses the queued messages; each sender is told and can resend.
- The "told" set is in memory: a board restart within the window may tell a sender a second time (stated cost).
- Review 1:
  - only while the box is the reason: an agent out of usage or signed out as well (its queue not released on that
    account) keeps the day and gets no "input box" notice, so a later reset still types it;
  - the notice counts as told only when it lands (placed or unconfirmed), otherwise the next sweep tries again;
  - a message kept behind an input-held one names the 2 hours in its receipt and the CLI lines (bash and Windows);
  - the tests drive the board's own sweepHooks, not a copy of them.
- Review 2:
  - a card that cannot be read or judged counts as limited (a doubt keeps the day);
  - the 2 hours count from the last sweep that saw the agent limited (in memory: after a restart, from arrival);
  - still-held notices are said after the sweep's typing, only for messages still kept;
  - the drop notice says "two hours" only when the 2-hour rule dropped it (the sweep passes `short`);
  - the told set is cleared on every removal path the sweep has (task lines and a person's DMs never enter it).
- Review 3:
  - the rule's test is direct: `boxIsReason` (the agent's queue released on usage and sign-in, AND its box reads text).
    A box that reads empty or unread (a backlog draining, a menu or quota hold), a missing card, a throw, or a caller
    that passes no boxIsReason all keep the day;
  - no notice in a sweep that found the agent released (its box read clear);
  - a notice that did not land is tried again no sooner than STILL_RETRY_MS (15 min);
  - a bad reset is never told as "two hours"; the file's doc comments name the 2-hour rule.
- Review 4:
  - the receipts say "after 2 hours with the box still full", since the clock restarts while the box is not the only
    reason (a flapping box can keep a message toward the day, never less);
  - the board's first sweep for an agent starts the clock, so a restart never drops a message on sight;
  - known cost, not changed: the box is read for boxIsReason and again by isReleased each minute, only for agents
    holding such a message.
- Review 5: the still-held notice's drop time is hedged ("if the box is still full then"), since the clock can restart
  after the notice. Accepted, not changed: a box holding an earlier Kosmos line that did not send also reads as text,
  so it counts as the box being the reason (the sentence stays true); the retry stamp uses the real clock where the sweep
  passes `now` (the same in production); a notice that fails after its message left the queue leaves one map entry.
- Review 6: a task line kept behind an input-held message gets no 2-hour clause in its receipt (it keeps the day).
- Review 7: spacing alone did not keep Kosmos's notices under a stall alert (deliverystreak.stallOf: 3 failures over a
  streak of 30 minutes; one notice retried at 0, 15 and 30 reaches it, and several messages from one sender add up). One
  notice per sender per sweep, across every recipient. The "keeps the day" tests were rebuilt so the first-sweep rule
  cannot pass them on its own: each starts the clock at arrival with the box as the reason, then reports the limit or the
  doubt; a mutation with boxIsReason ignored turns all four red.
- Review 8: review 7's own fix (a per-sender count of notices that did not land) could block a sender for good, since
  only a notice that landed cleared it and none was sent. Replaced by the streak itself: a notice goes only while the
  sender's deliverystreak.failCount (every failure kind, unconfirmed included, any recipient) is at least two short of
  STALL_MIN_FAILS, so it cannot make the third; any delivery that lands ends the streak and lifts it. An unconfirmed
  notice no longer counts as told.
- Review loop: 8 rounds is the cap, but round 8 found a defect in round 7's fix (a sender could be blocked for good),
  so one more round reviews that fix before the PR.

## Tests

engine/heldnote-7936.test.js (17 behaviour and source tests, besides the sandbox check, through limitqueue.sweepHooks): the not-only-the-box case and its control,
boxIsReason's wiring (four cases), a caller with no boxIsReason, the notice retried until it lands; the notice at 10 min (none at 9, once only, still kept, nothing typed into the box); the
drop at 2 h with its wording, a usage-limit hold of the same age kept (control); dropAfter by kind; the receipt and
CLI wording; the unanswered header. Control: with the drop back on DROP_AFTER_MS the 2-hour test fails. Existing:
limitmsg-5805, limittask-5805, inputkeep-6774 (engine, server, cli), limitdm-5805, agyhold-deliver-4588,
roomhold-4624, typingbroke-4926, the 4891 CLI gap tests and the unanswered tests (7155, 7848) all pass.
