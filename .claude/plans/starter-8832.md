# starter-8832: #8832, an agent can tell its welcome project from an empty real one

## Measured (before building)
- blockBody on main f03bf0a11f, sandboxed store: the welcome project and a real empty project rendered the same lines,
  both "No tasks set for this project yet. Add one with ... task add ...". The lines date from 09-10 (#2708), so
  0.8.12 is the same.
- The seed writes WELCOME_DESCRIPTION as the brief's Goal (brief.readGoal returns it), so an idle member of the empty
  welcome project qualified for the Assigner's goal ask: a daily ask to draft tasks for Kosmos's own sentence.

## Call
- projects.js: isStarter(record) = name WELCOME_NAME and made.via 'kosmos' (only the seed writes that), not a test
  project. STARTER_PROJECT_LINE under its name, in #8236's slot. Its empty list says "When your person gives you work
  here, add it with ..." instead of "Add one with ...". The subtask and --who lines stay: they say how, not whether.
- assigner.js: goalProject skips the starter project while isStarterGoal (still the seeded words,
  whitespace-normalised as goalFrom does), so tick, step and runOnce share one gate (review 1). A goal the person
  wrote there is asked as usual.
- The starter line is fixed words, not tied to the brief: the block is rewritten on a task or membership change,
  never when a brief changes, so a line that depended on the goal would go stale. Instead it counts a goal the
  person writes in the brief as work they gave (review 3: otherwise the line and the goal ask disagree).

## Rejected
- Changing WELCOME_DESCRIPTION: existing installs keep their seeded brief, so only the block reaches them.
- Skipping the starter project in the goal ask outright: a person who keeps the name and writes a real goal there
  would never be asked.
- A rulesChangedIn re-read for the new line: the line forbids nothing the agent was told to do; it arrives with the
  next rewrite (a task given, a membership change, a retell).

## Tests
engine/starter-8832.test.js, each with a control: real empty project unchanged; renamed or person-made "Getting
started" is not the starter; test project keeps its own line; seeded goal not asked, person's goal asked.
Mutations (8): starter never, ignore name, ignore made.via, test exclusion dropped, no assigner gate, any goal,
no starter line, old empty line. All red.

## Weakest premise
That the starter line does not make a new agent too passive in what is often its only project. The words allow any
work the person gives; the card's own agent read "nothing to add" as correct. (Not weak: the seed has written made.via
'kosmos' since the welcome home first existed, 3334e888d9 on 08-23, #166.)

Related tests: 70 files, 2,611 tests, 0 failed (11:25 CST).
