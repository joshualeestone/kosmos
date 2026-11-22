# connaccurate-8868: the Connections section an agent receives is always the accurate one (kosmos#8868)

Finished means: whatever writes an agent's "Connecting providers, plugins and services" section from current Kosmos,
the agent's file names `kosmos connections` and `kosmos accounts`, forbids reading `GET /api/connections` directly and
says why (it bills the person), never says there is no command, and never sends the agent to a read carrying a
credential, on every regeneration; and a guard in CI fails if that ever stops being true.

## Measured (2026-11-21, Agent1s)

- The section is the Connections block, written between the `kosmos:connections` markers by three callers that all
  splice the constant `blockBody()` (`engine/connectionsguide.js`): `engine/connections.js` `tellAgent` (board start and
  syncs), `engine/create.js` (an agent's birth) and `engine/discover.js` (an imported agent); the last two were found
  in review rounds 1 and 2. `instructionreread.js` only names the
  section in its re-read notice; it writes no text.
- The reported bad version matches the block of 2026-09-03 to 09-29 (`git log -S` on the phrase, measured in review
  round 1): "there is no one-word verb that prints accounts" was added in c946e47994 (09-03) and removed in 7328bedd16
  (#5359, 10-07); the billing warning arrived with #4451 (6a4741fd0b, 09-29). So 09-03 to 09-29 had the phrase, the
  board-token read and no billing warning, which is the reported bad version; 09-29 to 10-07 had the phrase and the
  warning; from 10-07 the phrase is gone. Current main says neither.
- No current code carries those words (`git grep` on origin/main finds them only in old plan files). Hundreds of old
  remote branches still do.
- On Agent1s, 24 agent files: 21 hold today's block, 2 old throwaway agents (zz-test-*) hold a long block from the
  09-29 to 10-07 window (file mtime 10-01; it has the phrase AND the billing warning; not rewritten since), 1 other (a
  different block, not the bad version). Every `CLAUDE.md.previous` (what the last write replaced) equals its current
  block: no flip on this computer.
- The report's install id (885080d4) is neither Agent1s nor Mortals. Splinter, 17:23: it is a WINDOWS board (its 20
  reports since 10-13 all name PowerShell), not Homer's install (45461372). Homer was asked over Slack whether
  pizzarama runs a second install with that id; nobody here touches that box. The flipping copy was not seen.

## The call

1. Guard the FILE, not only the source: `engine/connections-accurate-8868.test.js` writes the block into an agent
   file three times and checks every result (only the first write changes it), repairs a file holding the old block,
   checks the guide against the same rules (both commands, both prohibitions, the billing warning, each with its own
   control), and sweeps every .js, .mjs and .cjs file under engine/, bin/, install/ and tools/ and at the
   top level (491 files today) so every `spliceBlock` call on the Connections markers passes exactly `blockBody()`
   (whole calls are parsed, so one spread over lines, a destructured START and a
   concatenated body, another module's `blockBody()`, an inline `require('./connections').START`, the literal
   marker strings, a renamed destructured START and the marker bound to another name are all caught; its controls
   require all three known writers; projects.js is swept too). Not seen by the sweep: a body built
   into a variable before the call, the module required under a path it does not recognise or brought in with an ESM import,
   `spliceBlock` called under another name, and a call mis-split by a comment, a regex literal or a nested backtick
   inside it (the scanners skip
   strings only; stripping comments safely needs a real tokenizer, since `//` also appears inside URLs in strings).
   Each check has its own control (review round 1); dropping the billing clause from
   `blockBody` turns three arms red, and making discover.js splice other words turns the sweep red.

   What it cannot see: a writer running other code. And the guide is checked as `guideText()`, not as the
   `kosmos connections --how` output (connections.test.js covers the CLI printing it).
2. Make no change to the writer: it already replaces whatever sits between the markers, so the next write from current
   Kosmos puts the accurate block back (the repair arm proves it). One shape it does NOT repair: a file holding TWO
   Connections marker pairs is refused on purpose (it cannot tell which is ours; connections.test.js pins that), so a
   stale block there stays until a person removes one pair. Left as is: changing that refusal is a different decision.

Rejected: rewriting the block's words (they are already accurate, and the card's ask is about a second writer);
refusing writes from a throwaway board (touches #8860's area, Baron's, and the mechanism is not measured).

Weakest premise: that the flip comes from a writer running OLD code (an older Kosmos, or a board started from an old
checkout, whose workers folder defaults to the real ~/work/workers), not from current code. It fits the text exactly,
but nobody has read the affected computer. What would change my mind: a `.previous` on that computer whose old block
matches today's main, which would mean a current writer produced it.

Not done here: finding which process on the reporter's computer wrote the old text. That needs that computer.
