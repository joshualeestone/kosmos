# #9186: say when tasks wait on a project with no agent on it (beside #8996's activity line)

From #8996 (April, filed when she closed it): several projects on another install had open or on-hold tasks and NO
agent members, so nothing could move them, and a newly added coordinator could not tell a pause from missing staff.

## Change (engine/projectview.js)
- activityOf: `unstaffed`, the number of open or on-hold tasks (tasks.listGroup 'open' or 'held') on a project whose
  `agents` list holds no member: neither a stored name nor a described member object with a sessionName (overviewOf is
  given a described project, whose members are objects; review 1). Built tasks wait on a release, not on an agent, and closed ones on nothing: left out.
  0 when it has a member.
- activityLine: the #8996 line plus one sentence (unstaffedSentence) when unstaffed > 0:
  - "No agent is on this project to pick up its N open or on-hold tasks. Tell your person: they add an agent
    with the + beside Members on the project's page." (review 3: no agent command is offered: the reader is by
    definition not on the project, and the assign route refuses a non-member's writes on most projects; the words are
    the board's own NOT_ON_PROJECT_FIX);
  - paused: "No agent is on this paused project, so when your person resumes it, its N ... still need(s) someone added."
    (stands alone: the line before it does not always name the pause; review 3);
  - archived or test: nothing more.
- The old renderer is now activityCoreLine; activityLine = core + the sentence, so every #8996 path is unchanged.

## Rejected
- A board flag or "needs you": #8996 kept this to a `project show` line (#6209, #6341), and so does this.
- Counting built tasks: they wait on a release or a check, not on someone to work them.

## Weakest premise
That an empty `agents` list means nobody can move the work. A person can still give a task to any agent from the
screen, and the line says "tell your person" first.

## Tests: engine/projectview.unstaffed-9186.test.js (8)
- open + held counted, built and closed not; CONTROL staffed 0, no tasks 0, a missing agents field counts as nobody.
- the line word for word with the command; 1 task singular; paused wording; CONTROL staffed and archived say nothing.
- overviewOf on a real project carries the count, and renderShow prints it on the Last activity line.
- #8996's shape test now gives its fixture a member (it had none, so it would now carry unstaffed 2) and expects
  `unstaffed: 0`.
- Controls, each a perturbed copy: count always 0 (5 fail); built counted (1); paused not distinguished (1); archived
  not skipped (1). Every file touching the project view or project show (31): 385 tests, 0 fail.

## Reviews
- Round 1 (opus): 1 BLOCKER, 2 WARNING, 0 CONVENTION, 2 NIT.
  - BLOCKER: the member check kept only string entries, but on the real path (the overview route: projects.list ->
    describe -> overviewOf) members are objects with a sessionName, so EVERY staffed project with an open task was
    called unstaffed and told to "tell your person". Reproduced by the reviewer. Fixed: a name or a described member's
    sessionName counts; empty entries do not.
  - WARNING: the tests fed only the raw string shape, which is why the BLOCKER passed. Fixed: a test through
    projects.describe then overviewOf (staffed 0, CONTROL empty 1), described-shape staffed controls, and empty entries.
    Perturbation (string-only filter): 4 tests red, including the real-path one.
  - WARNING: #8996's shape fixture used the raw shape too. Fixed: a described member object.
  - NITs taken: "still needs" for one task; the comment no longer claims a starter case that cannot reach the sentence.
  - After: the two files 27/27; every project view file (31): 386 tests, 0 fail.
- Round 2 (sonnet): 0 BLOCKER, 1 WARNING, 0 CONVENTION, 3 NIT.
  - WARNING: the guard skips a test project, but no test pinned it. Fixed: a testOnly project with an open task and no
    agent says nothing about staffing; perturbation (test not skipped) 1 fail.
  - NIT taken: a comment that listGroup reads the stored task without projectPaused (paused open tasks count as open).
    NITs not taken: "either" in the paused sentence leans on the core line naming the pause (true on every path today);
    a redundant null check.
- Round 3 (opus): 1 BLOCKER, 1 WARNING, 0 CONVENTION, 3 NIT.
  - BLOCKER: the sentence offered `kosmos task assign ... --add-member`, but the assign route (notOnProjectRefusal) refuses
    a non-member unless the empty project was made by a process, and every reader of this sentence is a non-member.
    Confirmed in server.js. Fixed: the sentence points at the person with the board's own words (the + beside
    Members); no command. Test asserts no `task assign` in the line.
  - WARNING: the paused sentence's "either" leaned on the core line naming the pause, which the no-date path does not.
    Fixed: "No agent is on this paused project ..." stands alone; a no-date test; perturbation (old words) red.
  - NITs: plan test count (now 8); the unreachable starter guard (kept: a newer board); parked + unstaffed reads "quiet
    is expected" then the staffing sentence (accurate: nothing moves them once holds lift).
- Round 4 (sonnet): 0 BLOCKER, 1 WARNING, 0 CONVENTION, 3 NIT. Converged.
  - WARNING DEFERRED: the count follows the project's member list, so a project whose only member no longer runs reads
    as staffed. That is the card's definition ("no agent members"), and the Weakest premise above already names the
    member list as what this reads; a running-agent check would be a different card.
  - NITs not taken: "review 3" twice in one comment; an unused `id` parameter; listGroup computed twice per task.
- Final validation (6j) on e7f0902348: FAILED, 31647 tests, 1 fail: fixture-discipline.test.js "no test builds an agent
  card or a roster row by hand". Four test lines (one in the #8996 file, three in mine) wrote member objects with a
  `sessionName:` key, the round-1 fix's own fixtures. Fixed: members come from projects.describe (the real producer);
  the blank-object case is dropped (empty string and null still cover "nobody"). The two files plus the lint: 49/49.
  Rebased onto origin/main (brings #9184's pgrep fix). Back into the loop.
- Round 5 (opus): 0 BLOCKER, 1 WARNING, 0 CONVENTION, 5 NIT.
  - WARNING (SELF, prose): "nothing will move its N tasks" claimed more than the code knows (a person can still give a
    task to an agent from the screen; the count reads only membership). Fixed: "No agent is on this project to pick up
    its N open or on-hold tasks", which states exactly what is checked.
  - NIT taken: the plural paused wording is now printed by a test. NITs not taken: a parked + unstaffed pair (reads
    true); an unused `id` parameter; the unreachable starter guard; a member no longer on the computer counts as
    staffed (the card's "members" definition, already the Weakest premise).
  - After: the two files plus fixture-discipline 50/50.
- Round 6 (sonnet): 0 BLOCKER, 1 WARNING (a duplicate of the deferred members-not-running point), 0 CONVENTION, 3 NIT.
  NIT taken: a test title still quoted round 5's old words; renamed. NITs not taken: "Review 3" twice in one comment;
  a filter run on every call (cheap).
- Round 7 (opus): 0 BLOCKER, 0 WARNING, 0 CONVENTION, 3 NIT. Converged.
  NITs not taken: "Tell your person" read by the person themself (the #8996 core line beside it addresses an agent the
  same way; a reader-neutral wording is a small follow-up if wanted); a task held for the person counts as needing an
  agent (the card's "open or on-hold"); a test title says "from the real project" for a raw empty project (the
  described path has its own test).
