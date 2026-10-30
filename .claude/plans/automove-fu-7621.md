# automove-fu-7621: follow-ups after #7548's review (kosmos#7621)

The live mover (#7548, merged as #7624) runs only with AGENT_WORKFORCE_AUTOMOVE=1, so none of these reaches a person
while moves are off. Items as numbered on the card.

## Done
- Item 8: a candidate whose fresh re-check cannot be made is set aside for an hour (in memory, no record line), so the
  next candidate gets its turn. Before, the first candidate is always tried first, so one such agent blocked every move.
  A skipped line would say "no longer idle", which would be false here.
- Item 6: while the mover waits for its record, a move line says Kosmos would move it once it can write its record
  again, not "Kosmos will move", which contradicted the header above it.
- Item 3: while moving, a held account says no account Kosmos can use takes them (the mover's own holds count), not
  "no other account can take them".

- Item 4: a partial or unknown move (including one whose start threw after its write) tells the agent's thread where
  it may be. The #7548 test that expected no message for a partial now checks only that none says it moved.

- Item 2: Settings asks the mover leftAlone, which reads the person lines first (in the record and still waiting), so a
  person's move made since the last tick is not shown as one Kosmos will undo.

- Item 7: the sweep and the mover share one tick's deps, so the agents are walked once a tick, not twice.

- Item 1: server.automove-deps-7621.test.js builds the board's real deps in a sandboxed board, checks each answers in
  the shape the mover reads, and runs a real tick through them, off and on (control: dropping one dep is red).

## Decided, not changed
- Item 5 (a moved idle agent may hold its target a day, so about one move per target every one to two days): kept.
  Releasing a target sooner loosens rule 6 (no second agent onto a target not yet seen to work), which exists only for
  safety, and moves are off everywhere, so there is no data on how slow it is in practice. What would change it: a
  board with moves on whose record shows at-risk accounts waiting on unproven targets.

## Review rounds
- Round 1 (Sonnet, whole branch): no BLOCKER. The set-aside is part of passedOver, so Settings says Kosmos leaves
  that agent alone (the leaving line no longer names a reason, since it can be a move, a refusal or a check that could
  not be made). Only a re-check that failed for that agent (not on the fresh roster) sets it aside; a roster or project
  that could not be read at all holds nobody; a re-check that works ends the hold. While moving, a held account whose
  login stopped is left to the person, not "Kosmos would move". leftAlone ignores a waiting person line from the future.
- Round 2 (Opus, whole branch): no BLOCKER. Every per-agent failure of the strict re-check (not on the roster, its box,
  the guide check, its commitments) carries perAgent, and the set-aside keys on that, not on one message's words; old
  set-asides are pruned. A partial move no longer claims the agent stays put: the thread and Settings both say Kosmos
  did not see it restart there and to check which account it is on (a late restart or a stop can be partial too). The
  stopped case's test is strict again (no message at all); a partial is told exactly once. The real-wiring tick test
  says what it shows (it stops at the fewer-than-two-accounts check). Settings checks "leaves it alone" before the
  record pause. Three comments corrected.
