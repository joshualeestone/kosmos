# projreread-5320: a running agent is told when its projects block changes (kosmos#5320, part 1)

## Why
A 0.7.22 report: an agent kept nudging about a project its person had paused in chat. `kosmos project pause` (#4982) and
the standing line "When your person asks to pause a whole project, pause it" (engine/projects.js blockBody) both shipped
in 0.7.22, but an agent reads its file only when its session starts. projects.syncAgent rewrites the projects block on
task and membership changes, yet instructionreread (#5310) had no 'projects' section, so a running agent never learned
the new lines until a restart. Splinter 21:53 named the stale-instructions root; measured on main c6301c86c.

## Change
- engine/instructionreread.js SECTIONS gains `projects: 'the section headed "Your projects"'` (the block's heading).
- engine/projects.js syncAgent: when tellAgent's verdict is TOLD and `changed === true`, oweNow(key, 'projects'). Never
  fails the write (try/catch); an unchanged write owes nothing.

## Tests
engine/projects.test.js "#5320: a CHANGED projects block owes the running agent a re-read; an unchanged write owes none":
the first sync changes the block and owes ['projects']; a second, unchanged sync owes nothing (control). projects +
instructionreread tests 183/183. Red against origin/main's projects.js (the owe assertion fails).

## Part 2 (next): `kosmos project pause <id> --ask` (a Pause project button in the room; one click pauses as the verb does).

## Weakest premise
Noise: a busy agent whose tasks change often is owed a re-read each time the block changes. Debts merge per agent and a
landed line clears them all, so it is at most one line per delivery pass (INSTRUCTION_REREAD_MS, 5 minutes), sent only
when the agent is idle. Not yet measured on a live busy agent.
