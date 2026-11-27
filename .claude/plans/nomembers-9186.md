# #9186: say when tasks wait on a project with no agent on it (beside #8996's activity line)

From #8996 (April, filed when she closed it): several projects on another install had open or on-hold tasks and NO
agent members, so nothing could move them, and a newly added coordinator could not tell a pause from missing staff.

## Change (engine/projectview.js)
- activityOf: `unstaffed`, the number of open or on-hold tasks (tasks.listGroup 'open' or 'held') on a project whose
  `agents` list is empty or missing. Built tasks wait on a release, not on an agent, and closed ones on nothing: left out.
  0 when it has a member.
- activityLine: the #8996 line plus one sentence (unstaffedSentence) when unstaffed > 0:
  - "No agent is on this project, so nothing will move its N open or on-hold tasks. Tell your person, or give one to an
    agent with `kosmos task assign <id> <task-number> <agent> --add-member`." (the verb that adds a member exists);
  - paused: "No agent is on it either, so when your person resumes it, its N ... still need someone added." (a pause
    reads as on purpose, distinct from missing staff);
  - archived, test or starter: nothing more.
- The old renderer is now activityCoreLine; activityLine = core + the sentence, so every #8996 path is unchanged.

## Rejected
- A board flag or "needs you": #8996 kept this to a `project show` line (#6209, #6341), and so does this.
- Counting built tasks: they wait on a release or a check, not on someone to work them.

## Weakest premise
That an empty `agents` list means nobody can move the work. A person can still give a task to any agent from the
screen, and the line says "tell your person" first.

## Tests: engine/projectview.unstaffed-9186.test.js (5)
- open + held counted, built and closed not; CONTROL staffed 0, no tasks 0, a missing agents field counts as nobody.
- the line word for word with the command; 1 task singular; paused wording; CONTROL staffed and archived say nothing.
- overviewOf on a real project carries the count, and renderShow prints it on the Last activity line.
- #8996's shape test now gives its fixture a member (it had none, so it would now carry unstaffed 2) and expects
  `unstaffed: 0`.
- Controls, each a perturbed copy: count always 0 (5 fail); built counted (1); paused not distinguished (1); archived
  not skipped (1). Every file touching the project view or project show (31): 385 tests, 0 fail.

## Reviews
