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

## Still to do
- Item 1: a test that runs the mover through the board's real deps.
- Item 5: throughput (a moved idle agent may hold its target a day).
- Item 7: the second agents walk per tick.
