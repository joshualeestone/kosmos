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
3-minute deadline. A second premise: that a delivery stuck past the deadline is rare, since the late one still holds
the agent's pane and a later prompt to that agent is then read as pane-busy and dropped (stated in the code).

## Review rounds
- Round 1 (Opus, the branch on top of #7611): no BLOCKER; it confirmed the sync sender unchanged, no double prompt
  and no lost entry (each prompt reads the book at its own turn on the chain), the chain cannot stop, and the busy
  check and the send in one turn. Fixed:
  - W1 each prompt used the roster captured when the mark arrived, though its turn on the chain can come minutes
    later: it reads the board's roster at its turn (the route's only if that cannot be read). Pinned; mutant red.
  - N the pin counting calls into the core matched the sync name as a prefix of the async one: each name is counted
    exactly, and the sync sender must not be called from the board.
  - N the plan's unmeasured "1.5 s" is gone; its weakest premise names the deadline's cost.
  Decided: W2 a delivery past the deadline is booked while it still runs, and holds the pane, so a later prompt to
  that agent is read as pane-busy and dropped, and a late refusal leaves its task booked: the idle sweep's choice,
  bounded by a delivery stuck for over three minutes, now stated in the code. The chain is pinned by source text;
  the race it closes is shown in engine/communitytaskdone.test.js.
- Round 2 (Sonnet, the branch on top of #7611): no BLOCKER; it confirmed no double prompt, no lost entry, no lasting
  stop, the busy check and send in one turn, roster and book read at the prompt's turn. Fixed:
  - N the close route still built a full roster snapshot after its 200 (the event-loop cost this card removes), which
    the prompt then read again at its turn: the route no longer passes one.
  - N the built route's comment named the old synchronous keystroke.
  Decided, not changed:
  - W one chain for every agent: a stalled delivery delays every later prompt by up to the 3-minute deadline. Delayed,
    never lost, and each prompt re-runs its gates at its turn. A chain per agent would still need the book serialised.
  - W a restart between typing and booking (up to the deadline) leaves a prompt that reached the pane unbooked, so a
    later mark on that task can prompt once more; the idle sweep accepts the same trade.
  - N pane-busy is asked before the sender's own holds, so a pane both busy and held is logged pane-busy (neither books).
- Round 3 (Opus, the branch on top of #7611): no BLOCKER; it re-confirmed no double prompt or lost entry in one board
  process, no lasting stop, the busy check and send in one run, the sync sender unchanged, and the close route's
  missing roster harmless. Fixed:
  - N two comments overstated: a busy window is refused as pane-busy (only an agent mid-turn gets it Queued), and the
    prompt never holds the event loop (it never held the 200).
  - N tests: a sender that throws at once reads as unconfirmed; a busy check that throws lets the prompt go.
  Decided, not changed:
  - W2 again (round 2 too): a restart between typing and booking can mean one more prompt for that task. Booking
    first and unbooking on a miss would trade that for a possible missed prompt instead; both need a restart mid-
    delivery, and the idle sweep books after the answer too, so the two senders stay alike.
  - W1 and W3 as rounds 1 and 2 (one chain, delayed never lost; a deadline books the task), stated in the code. A
    restart also drops prompts still waiting on the chain (in memory, never double-sent).
  - N the built route still passes its own roster (a fallback it already has); the close route passes none.
