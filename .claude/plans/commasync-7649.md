# commasync-7649: the community turn awaits each delivery (kosmos#7649, idle-sweep half)

## The problem
The board's community-turn timer called communityturn.tickOnce with the synchronous chat.deliverAutomatic, holding
the event loop while it typed into each agent's pane.

## The change
engine/communityturn.js: tickOnce split into shared begin / capped / lineFor / settle; tickOnce stays synchronous;
tickOnceAsync awaits each delivery, one agent at a time. server.js: the timer runs one pass at a time (a running flag
cleared in finally, as the reply nudge) with tickOnceAsync and chat.deliverAutomaticAsync.

The task-done half (#7611's prompt) is a separate branch, commasync-td-7649, stacked on #7611.

## Weakest premise
That a 3-minute ceiling on one delivery is far above any real wait. If a pane's queue can legitimately hold a line
longer, that agent is booked as unconfirmed and its line may still land later: one turn, never two.

## Review rounds
- Round 1 (Opus, whole branch): no BLOCKER. Fixed, each with a test and a red mutant:
  - W1 a delivery that never settles kept the one-pass flag set forever: a 3-minute deadline counts it UNCONFIRMED
    (booked) and the pass moves on. Rejected: a pass deadline that clears the flag (it lets a new pass overlap the
    hung one, the double-booking the flag exists to stop).
  - W2 the shared hour cap could be exceeded by one while a line was typed: the slot is held in the log during the
    await and given back before the verdict is booked.
  - W3 the second due agent could start working during the first delivery: each agent after the first is checked on
    a fresh roster and left unbooked if no longer idle.
  - N4 the log line lost its space after "community-turn:" (my edit): restored and pinned.
  - N5 the parity test now compares the idle-seen set too.
  - N6 a stop mid-pass lost that pass's bookings: o.saveBook runs after each booking.
- Round 2 (Sonnet, whole branch): no BLOCKER. Fixed, each with a test and a red mutant:
  - W1 agents after the first were delivered with the pass's starting roster (pane, question-menu and quota holds come
    off the card): they now get the fresh roster the re-check reads.
  - W2 the gates were read only at the start of a pass that can now run minutes: before each agent after the first,
    the gates are read again (an off gate stops the pass and clears the idle marks, as at the start) and the agent
    must still be in the community.
  - W4 every booking and "Sent" stamp used the pass's start time: each agent after the first reads the clock again
    (a test's fixed o.now still pins it).
  - N an agent skipped by the re-check is dropped from the idle-seen set.
  Decided, not changed:
  - W3 a delivery past the deadline still sits in chat's per-pane queue: that queue has no ceiling of its own, and a
    delivery that never settles blocks it with or without this pass waiting on it. Not this card.
  - N a re-check skip keeps the agent's older communityready record (no new act in the results vocabulary); the timer
    is unref'd (the deadline test passes, and M1 of round 1 shows a cancelled test turns the run red); cross-nudge
    spacing between the community turn and the other nudges is the existing design, not this card.
