# connaccurate-8868: the Connections section an agent receives is always the accurate one (kosmos#8868)

Finished means: whatever writes an agent's "Connecting providers, plugins and services" section from current Kosmos,
the agent's file names `kosmos connections` and `kosmos accounts`, forbids reading `GET /api/connections` directly and
says why (it bills the person), never says there is no command, and never sends the agent to a read carrying a
credential, on every regeneration; and a guard in CI fails if that ever stops being true.

## Measured (2026-11-21, Agent1s)

- The section is the Connections block: one writer, `engine/connections.js` `tellAgent`, splicing `blockBody()`
  (`engine/connectionsguide.js`, a constant) between `kosmos:connections` markers. `instructionreread.js` only names
  the section in its re-read notice; it writes no text.
- The reported bad version matches the block BEFORE #4451 (2026-09-29, 6a4741fd0b^): "there is no one-word verb that
  prints accounts, so it is a direct read of `GET /api/accounts`" with the board token, and no Connections part, so no
  billing warning. The 10-01 to 11-03 long block still says "no one-word verb" but keeps the billing warning; current
  main says neither.
- No current code carries those words (`git grep` on origin/main finds them only in old plan files). Hundreds of old
  remote branches still do.
- On Agent1s, 24 agent files: 21 hold today's block, 2 old throwaway agents (zz-test-*) hold the 10-01 long block
  (not rewritten since), 1 another. Every `CLAUDE.md.previous` (what the last write replaced) equals its current
  block: no flip on this computer.
- The report's install id is neither Agent1s nor Mortals; `mini` did not answer ssh. The flipping copy was not seen.

## The call

1. Guard the FILE, not only the source: `engine/connections-accurate-8868.test.js` writes the block into an agent
   file three times and checks every result, repairs a file holding the old block, and checks the guide. A control
   proves the checks fail on the old text; dropping the billing clause from `blockBody` turns two arms red.
2. Make no change to the writer: it already replaces whatever sits between the markers, so the next write from current
   Kosmos puts the accurate block back (the repair arm proves it).

Rejected: rewriting the block's words (they are already accurate, and the card's ask is about a second writer);
refusing writes from a throwaway board (touches #8860's area, Baron's, and the mechanism is not measured).

Weakest premise: that the flip comes from a writer running OLD code (an older Kosmos, or a board started from an old
checkout, whose workers folder defaults to the real ~/work/workers), not from current code. It fits the text exactly,
but nobody has read the affected computer. What would change my mind: a `.previous` on that computer whose old block
matches today's main, which would mean a current writer produced it.

Not done here: finding which process on the reporter's computer wrote the old text. That needs that computer.
