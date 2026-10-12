# nonmember-5971: giving a task to an agent not on the project says so (CLI and API)

Card: kosmos#5971 (split from #5956 part 3, Mona Lisa). Builder: Angel.

## Done when
Giving a task to a non-member through the CLI or the API says so before or as it happens, and a member is unaffected,
tested both ways (the card's own words).

## Measured first (origin/main 59abeef31)
The card's premise does not hold on main: the engine already REFUSES both, with a sentence the CLIs print.
- `tasks.create` with a non-member `who`: "that agent is not on this project, so the task cannot be given to it".
- `tasks.assignPart` to a non-member: "that agent is not on this project, so the part cannot be given to it".
- The add route answers 400 with that sentence; `task assign` is already tested for it (server.task-assign-4914).
`resolveWhoAsked` passing an unmatched name through "as typed, for the engine to refuse" is that refusal's input.

## The gap, and the change
No test drives `task add --who <non-member>` through the route with the REAL engine: server.task-who-4887 stubs
tasks.create, so a regression that let a non-member through would pass every test. This adds
server.task-nonmember-5971.test.js: add and assign, each refused (and nothing written) with a member control, each run
on the agent CLI's path (its token, recorded as a process add) and the page's.

## Rejected
- A warning that lets the assignment through: the engine's refusal is stricter and already what the card asks for.
- A refusal with an override flag: nothing on main lets a non-member through, so there is nothing to override.

## Weakest premise
That #5956's collisions came from this path. One concrete other way is visible on main: an agent REMOVED from a project
keeps the parts it held (removeAgent does not clear `who`, by design per the comment above assignPart), so work can
sit with someone no longer on the project. Not giving work, so not this card; named on the card as a lead.
