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
- Round 3 (Opus, whole branch): no BLOCKER. Fixed, each with a test and a red mutant:
  - W1 the awaited sender queued behind a message still being placed and then typed (the synchronous one refused, read
    as pane-busy, unbooked): chat.js's refusal is now one exported helper, paneBusyVerdict, used by deliver and asked
    by the pass before each delivery; a busy pane is pane-busy, unbooked, with no slot held. The parity test's injected
    busy verdict is now also what the real path produces.
  - W2 the re-check before the second agent was weaker than due(): it now runs due() again for that one agent (a new
    `only` filter, so the whole roster still feeds the quota check and the per-pass cut cannot hide it), on a fresh
    roster, projects and clock. A post, a fresh idle report or a pause mid-pass skips it.
  - N capped() now runs after the re-check, on that agent's clock; keep() records at p.now; the module header names
    the awaited sender.
  - Got wrong, corrected: the log line's space was lost a SECOND time by my own edit (a match ending in a space); the
    round-1 pin caught it. And my first paused-project fixture used fields that do not exist; its control caught that
    it stood nobody down, so the case tested nothing until fixed.
  Decided, not changed: a deadline books UNCONFIRMED even if the late delivery is refused later (errs safe, accepted in
  round 1); the one-pass flag is pinned by source, not run (the timer body needs the whole board).
- Round 4 (Sonnet, whole branch): no BLOCKER; it found chat.deliver unchanged for its other callers. Fixed, each with a
  test and a red mutant:
  - W1 the round-3 re-check could not see a post made mid-pass: the board reads posts.json once a pass, and my unit
    test used a fresh reader, so it passed while the wiring did not. The pass now calls o.beforeRecheck, which the
    board uses to drop its copy; the new test models the board's caching reader, and its control (no hook) shows the
    miss.
  - N the book is saved only after a booking, not after a held or busy verdict.
  Decided, not changed: W2 (a deadline then a late refusal costs the agent its turn) as round 1; the hour cap read once
  a pass (a limit lowered mid-pass applies from the next pass, at most two agents later); the roster re-read is the
  same snapshot every timer reads each tick, at most once a pass; the 30 ms clock test (Date.now has 1 ms resolution).
- Round 5 (Opus, whole branch, nothing settled): no BLOCKER; it confirmed the timer cannot stop, no double prompt, the
  hour log neither leaks nor steals, tickOnce, due()'s callers and chat.deliver's callers unchanged. Fixed, each with a
  test and a red mutant:
  - W a failed re-check dropped the agent from the idle marks whatever the reason (a quota hold, a failed read), so its
    next turn came a pass late: now only when its fresh card is no longer idle. The round-2 test that pinned the old
    drop for an idle agent that left the community now pins the new rule.
  - N the delivery started a microtask after the busy check: it is now called in the same turn.
  - N settle uses logAt (one copy of the time-ordered insert); the server comment says when the book is written.
  Decided, not changed: the hour cap and the communityready prune list are read once a pass (bounded to the second
  agent); paneBusyVerdict's catch can only swallow a throw deliver's own resolveCard raises first; the hour-log entry is
  stamped at send start (at most the 3-minute deadline early); the one-pass flag is pinned by source text.
