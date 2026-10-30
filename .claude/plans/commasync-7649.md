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
