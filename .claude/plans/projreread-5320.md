# projreread-5320: a running agent is told when its projects block changes (kosmos#5320, part 1)

## Why
A 0.7.22 report: an agent kept nudging about a project its person had paused in chat. `kosmos project pause` (#4982) and
the standing line "When your person asks to pause a whole project, pause it" (engine/projects.js blockBody) both shipped
in 0.7.22, but an agent reads its file only when its session starts. projects.syncAgent rewrites the projects block on
task and membership changes, yet instructionreread (#5310) had no 'projects' section, so a running agent never learned
the new lines until a restart. Splinter 21:53 named the stale-instructions root; measured on main c6301c86c.

## Change
- engine/instructionreread.js SECTIONS gains `projects: 'the section headed "Your projects"'` (the block's heading).
- engine/projects.js: the block's standing rules (everything but project and task lines) move into blockRules();
  tellAgent reports `rulesChanged` (rulesChangedIn: a rule in the new block is missing from the OLD block). syncAgent
  owes 'projects' only on rulesChanged, and logs a debt it could not record, as its siblings in server.js do.
- Review 1 (iteration 1) changed the trigger from "the block changed" to "a rule changed": an agent closing its own
  task, a first task arriving, joining (membershipLine already says read the section) and leaving (the section is
  gone) all changed the block and would each have cost a needless turn.

## Tests
engine/projects.test.js "#5320: only a change to the block's standing rules owes the running agent a re-read":
join owes nothing; a block missing the pause rule (an older Kosmos) owes ['projects'] on rewrite; an unchanged
write, a task arriving, the agent's own task closing and leaving the last project each owe nothing. Red on the old
trigger (`changed`): "joining owed a second line". A second test covers the tasks rules: an older tasks wording beside
a still-open task is owed; the same older block as the last task closes owes nothing. Red with the tasks rules never
compared, and red with the new-block check removed.

## Part 2 (next): an agent unsure whether to pause asks in the room and points at the Pause button beside the project's
name (Mona's #5391, PR #5395). Built after that merges, so the line never names a button that is not there.

## Behaviour by design (review 2)
- Only ADDED rules owe: a rule taken out needs no re-read. Tasks rules count only when the old block listed a task
  and the new block still carries them (a last task closing takes them out; a first task is announced where assigned).
- The rules embed the CLI command as this machine shows it (kosmosCliShown). If that spelling changes, every member is
  owed one re-read at its next block rewrite: the command it would copy changed, so that is wanted.

## Review 3: a screen pause
A pause or hold set or lifted on the screen marks the agent's open task lines (`[on hold: ...]`) and posts no room note,
so a running agent never learned it. A changed hold marker on a task both blocks list now owes the re-read (holdsOf).
It lands when the agent is next idle, so an agent mid-task finishes that turn first. A pause made with
`kosmos project pause` also posts a room note; every member with an open task there is still owed the re-read (the
pausing agent included), one line when idle. Redundant beside the note, not wrong, and pauses are rare: accepted.
A task's key is "task <n> of <project name>"; two projects with one name share it, so the markers are kept as a list
(review 5).

## Known limit
No board-start sweep: an agent whose FILE already got the pause rule before this ships, while its session predates it,
is not owed a re-read; it learns at its next start. A sweep cannot tell what a session read. Its next rules change,
or a restart, reaches it.
Not covered: the commands taught on each project's own lines (post, its tasks, --parent, --who me) carry the
project's id and are not compared, so a change to them owes nothing. Task lines in a spelling before #779 (`task <n> of`)
are not read as tasks, so a tasks-rules change in such a block is missed (it fails toward silence, not noise).
A rename and a pause in one request changes every key, so that pause is missed (silence, not noise).
Also one-shot: if the debt cannot be recorded (logged to stderr), the next sync sees no change and does not retry.

## Weakest premise
That the tasks rules need not be owed when a first task arrives: the assignment is announced where it is made, and
that line is assumed to point the agent at its task list.
