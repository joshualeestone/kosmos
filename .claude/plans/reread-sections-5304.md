# reread-sections-5304: tell running agents when the other board-start sections change (#5304, follow-up to #5297)

Card: kosmos#5304 (Splinter 2026-10-05 10:1x: "YES, tell the agent for those too, but as a follow-up slice after #5297
merges"). Owner: Angel. Stacked on #5310 (community-refresh-5297); the PR targets that branch until it merges.

## Finished looks like
When the board rewrites one of the five other managed sections in a running agent's file, at board start or when the
person saves About you, that agent is owed one "read this section again" line through #5297's instructionreread debt
(idle-gated, retried until it lands), naming the section by the heading actually in its file.

## Changes
1. engine/you.js, reports.js, connections.js, dmfiles.js, personlanguage.js: tellAgent reports `changed` (true on a
   real write, false when the text was already current). No other behaviour change.
2. engine/instructionreread.js: SECTIONS gains you, reports, connections, dmfiles, language (each by its block heading);
   oweEach(told, owed, section) owes `section` to every verdict with changed true.
3. server.js: instructionRereadOweEach(told, section) after each board-start sweep and in PUT /api/you (the About-you
   block and its three side sweeps). Never throws; an unreadable debt file is never replaced (readOwedStrict).

## Decided
- The About-you save owes a re-read too (the card's open question): a saved name or role is exactly what a running agent
  should pick up, and the line is idle-gated like every other.
- Sections are owed per block, so one line names every section an agent owes.
- The five sections need no Community or Prompter switch (they are not community lines); live execution and the brake
  gate them, as for the working rules.

## Weakest premise
The first board start after this ships may owe several sections to many agents at once; MAX_PER_PASS (3) paces it.

## Validation
engine/instructionreread-sections-5304.test.js (each module's changed flag, with the heading the line names checked
against the real file), oweEach, server wiring pins, every board-booting test (13 files), the five modules' own tests,
the file-scanning guards.

## Round 1 (fixed / decided)
The connections line names both headings its block writes (the Connections tab section is the newest part), and the
test now checks every heading in each block is named. Switching the language back to English removes the block and owes
nothing (`removed`); the agent drops the old language at its next start (decided: a line pointing at a section that is gone
would mislead). personlanguage's early returns say changed: false; stale board-start comments note the re-read.
Decided: you.tellAgent also reports changed when only the colleagues heal wrote (the line then names "Who you work for");
accepted, rare. Follow-up, not this card: the per-agent profile save (role/reportsTo, server.js ~13638) rewrites the
reports block for a running agent without owing a re-read.
