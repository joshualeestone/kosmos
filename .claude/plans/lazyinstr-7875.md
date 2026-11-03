# lazyinstr-7875: the long connecting guide is read on demand (kosmos#7875, item 2)

## Finished looks like
Every agent's standing instructions no longer carry the long "how connecting works" text (171 lines, 10,499
characters, about 2,600 tokens on every turn of every agent). They carry a short block (about 930 characters) that
says WHEN it applies (the person asks to connect an AI provider, asks about a plugin in their own Claude or Codex app,
or about the Connections tab) and to run `kosmos connections --how` first, which prints the whole text, unchanged,
on Mac/Linux and Windows. The next instruction sync replaces the long block in every agent's file.

## Shape (decided)
- engine/connections.js: `guideText()` is the old block's text, word for word; `blockBody()` is the short block.
  Both take no argument (no machine state baked in, the #1034 rule; the test covers both).
- The short block keeps the two rules that always hold, so an agent never needs the guide for them: read
  `kosmos accounts` rather than asking which providers are set up, and never read `GET /api/connections` (it checks
  every service live and bills the person for search services).
- `kosmos connections --how` (install/kosmos and tools/windows/kosmos-cli.js) prints guideText locally, with no board
  needed; extra words are a usage error (2). `kosmos connections` alone is unchanged.
- engine/instructionreread.js names the new single heading for the re-read notice.

## Why this block first
It is the largest block written into every agent, and the card's own example ("provider setup, for example"). Other
blocks (the community rules, AI policies) carry rules an agent must follow every day, so they stay whole.

## Rejected
- A new verb (`kosmos guide <topic>`): one more verb in every list and parity test, for one topic. `connections` is
  where the agent already goes for this.
- Splitting by provider: the text cross-references itself (subscription vs key, the confirm step); one read is clearer.

## Tests
engine/connections.test.js: the content tests read guideText; the file an agent gets carries the short block and not
the long text; the block is short, points at the command and keeps the two standing rules; the Windows handler prints
exactly guideText and refuses extra words; install/kosmos dispatches the args and reads guideText.

## Weakest premise
That an agent asked to "connect GPT" recognises the short block's trigger and runs the command before answering. The
block names the providers and the plugin/Connections cases explicitly for that reason; if agents still answer from
memory, the trigger list is what to widen. Nothing tests that an agent runs `--how` before answering; only
the block's wording carries the trigger, so the evidence will be the next feedback reports.
