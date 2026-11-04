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

- engine/limitqueue.js: `INPUT_DROP_AFTER_MS` (2 h, the room's own HELD_TELL_MAX_MS) and `STILL_HELD_TELL_MS` (10 min).
  `dropAfter(e)`: 2 h for a `kosmos msg` kept for the box (input: true, no kind), a day otherwise. The sweep calls
  `onStillHeld(e, roster, dropAt)` once per entry (in memory) STILL_HELD_TELL_MS after its reset.
- engine/messages.js: `tellHeldStill` types the notice into the sender's pane; `tellHeldDropped` says "for two hours
  while its input box held text not yet sent" for those; the receipt adds "or drops it after 2 hours and tells you".
- install/kosmos and tools/windows/kosmos-cli.js: the CLI's held line names the 2 hours.
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
    account, the hooks' `isLimited`) keeps the day and gets no "input box" notice, so a later reset still types it;
  - the notice counts as told only when it lands (placed or unconfirmed), otherwise the next sweep tries again;
  - a message kept behind an input-held one names the 2 hours in its receipt and the CLI lines (bash and Windows);
  - the tests drive the board's own sweepHooks, not a copy of them.
- Review 2:
  - a card that cannot be read or judged counts as limited (a doubt keeps the day);
  - the 2 hours count from the last sweep that saw the agent limited (in memory: after a restart, from arrival);
  - still-held notices are said after the sweep's typing, only for messages still kept;
  - the drop notice says "two hours" only when the 2-hour rule dropped it (the sweep passes `short`);
  - the told set is cleared on every removal path.

## Tests

engine/heldnote-7936.test.js (12 tests, through limitqueue.sweepHooks): the limited case and its control, isLimited's
wiring, the notice retried until it lands; the notice at 10 min (none at 9, once only, still kept, nothing typed into the box); the
drop at 2 h with its wording, a usage-limit hold of the same age kept (control); dropAfter by kind; the receipt and
CLI wording; the unanswered header. Control: with the drop back on DROP_AFTER_MS the 2-hour test fails. Existing:
limitmsg-5805, limittask-5805, inputkeep-6774 (engine, server, cli), limitdm-5805, agyhold-deliver-4588,
roomhold-4624, typingbroke-4926, the 4891 CLI gap tests and the unanswered tests (7155, 7848) all pass.
