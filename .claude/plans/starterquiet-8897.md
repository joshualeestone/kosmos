# kosmos#8897: the starter project shows as a placeholder; no empty-queue prompts until work arrives

## Measured first (is the card still live?)
- No empty-queue prompts: ALREADY TRUE on main, from kosmos#8832 (merged; its card is still open). The only prompt an
  idle member of an empty project gets is the Assigner's goal ask (engine/assigner.js goalProject), and it skips the
  starter project while its goal is still Kosmos's seeded words (projects.isStarterGoal). The Prompter's agent nudge
  (engine/agentnudge.js) reaches only an agent that holds an open task, so it cannot fire on an empty project.
- The agent is told what it is: ALREADY TRUE (#8832: STARTER_PROJECT_LINE under its name, and its empty task line does
  not invite filling).
- Shows as a placeholder TO THE PERSON: NOT TRUE. The page had no mark at all. That is what this change builds.

## Finished looks like
1. /api/projects sends `starter: true` on the project Kosmos seeded (projects.describe, by the same isStarter rule the
   instructions use); every other project, the welcome one once the person renames it, and a test project, carry no key.
2. That project's empty Tasks column reads "This is the starter project Kosmos made to show you around. Its agents are
   waiting for you: give them a task here, or start your own project." (Mona Lisa's design read) while it has no task at all; with no agent on it yet (it can be seeded
   before any agent exists), "... Add an agent to it, or start your own project." (review 1); with one, "Its agent is
   waiting for you: give it a task here ..." (review 3).
3. Once work arrives (any task, open or finished) it reads as any project does; renamed, it reads as any empty project.
   CONTROL: a real empty project keeps "Add a task, or have an agent add one, to start tracking progress."

## Calls
- A sentence in the empty column, NOT a badge on the project card: Josh's #4730 rule (2026-09-30) is to show a badge only
  when something is actually running, and Paused was added as a separate option for him to choose. A "Starter" badge
  would bend that rule; the empty column is where the person meets the emptiness.
- The flag comes from the engine (one rule for the instructions and the page), not recomputed on the page.
- The column's repaint guard now keys on WHICH empty sentence it shows. It keyed on the cards' HTML only, so every empty
  column was the same key: a project renamed while empty kept the starter sentence (and, before this change, a column
  with only finished tasks that lost them kept "Nothing open here"). Switching projects already resets the guard.

- Review 3: the check is indexed in docs/browser-checks/README.md (browser-checks-indexed.test.js); the design-shots
  screen uses the file's own editProjects helper (GET only, fetch and answer inside one try: the #6022 teardown guard).
  With those tests, the wiring test, both starter tests and the two lints: 47 of 47.
- engine/starter-8832.test.js's scan for writers of the seed mark now leaves out docs/browser-checks/ (the design-shots
  screen stubs a Kosmos-made project in a page answer and writes no store); a planted second writer in engine/ still
  turns it red.

## Deferred, not missed (review 1)
- The scoped Tasks view behind View All says "No tasks match." for this project, and the iPhone app's Tasks screen says
  "No tasks yet / Add one with +, or ask an agent to." Neither marks the starter. Left out on purpose: the project page
  is where the person meets the starter project, the Tasks view is a filter across projects, and the iPhone app is a
  separate build and release lane. A follow-up if the person ever lands on those first.

## Weakest premise
That "placeholder" in the card means something the person sees on the project, not a new state in the data. If Josh
wants a visible mark on the project CARD, that is a #4730 question for him, not a reversible call for me. Second
(review 1): if the person rewrites the starter's brief but keeps its name, the Assigner asks about the new goal as usual
(it is theirs now), while the page still calls it the starter project; both are true, but the agents are no longer quiet.

## Evidence
- engine/starter-page-8897.test.js: the list marks the seeded starter, and not a real empty project, a test project or
  the welcome project once renamed. With engine/starter-8832.test.js, the 16 engine/projects*.test.js files and the two
  repo lints: 329 of 329 run (3 skipped); the 7 server.project*.test.js files 231 of 231.
- docs/browser-checks/render-starter-empty-8897.js, listed in gated.txt so the runner runs it (review 2: it was wired into
  nothing; tools.browser-checks-wired.test.js fails without the line, 11 of 11 with it; the gated runner ran it green at
  638fb924d8): 32 of 32 (chromium and webkit, 1100 and 390): starter empty; renamed
  in place; back; a task arrives; finished work only; a real empty project (CONTROL).
- Mutations, each red: the page's starter branch removed; the old repaint guard; the engine marking every project;
  isStarter without its made-by-Kosmos check (the lookalike-name control); the no-agent sentence removed.
- Design shots: ~/work/design-shots/kosmos-8897/ (screen project-starter-8897, desktop and iPhone, light and dark).
