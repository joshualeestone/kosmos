# tdasync-7649: the task-done prompt awaits its delivery, one at a time (kosmos#7649, task-done half)

## The problem
#7611's task-done prompt (promptCommunityOnTaskDone in server.js, engine/communitytaskdone.js) runs after the 200 of
the built and close routes, and called the synchronous chat.deliverAutomatic, holding the event loop while it typed.

## The change
- engine/communitytaskdone.js: promptOnTaskDone split into shared decide and settle; it stays synchronous;
  promptOnTaskDoneAsync awaits the delivery, asks o.paneBusy first, and bounds the delivery with a deadline.
- server.js: the helper uses chat.deliverAutomaticAsync and chat.paneBusyVerdict, and every task-done prompt waits for
  the one before it on TASK_DONE_CHAIN (each reads the dedup book, delivers and writes the whole book back, so two at
  once could both pass the dedup, and a later write could drop an earlier entry).

Stacked on #7611 (community-prompt-on-built-5313, merged with main at 38ea8b426f, handed to PigeonPete by its owner).
Once #7611's squash lands on main, this branch is moved onto main.

## Decided
- One chain rather than a per-task in-flight set: a per-task set cannot see the lost update between two DIFFERENT
  tasks' writes of the whole book.
- Carried over from the idle sweep's six review rounds before this review began: the busy-pane refusal (the awaited
  sender would type straight after another message) and the delivery deadline (one delivery that never settles would
  stop every later prompt on the chain).

## Weakest premise
That marks arrive slowly enough for an unbounded chain: each entry is one task mark, and each waits at most the
3-minute deadline (about 1.5 s in practice).

## Review rounds
