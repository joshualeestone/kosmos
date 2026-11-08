# kosmos#8236: a test-project mode

The call (on the card): a per-project `testOnly` flag, not a recommended description. When a project has no open
task, the Assigner's goal nudge asks each idle member to add up to 3 tasks, or to say in the room that there is nothing
to add. A test description cannot stop that nudge, and the room post is the noise the card reports.

1. engine/projects.js: `testOnly` is a boolean carried by edit() like paused (absent = off); isTestOnly(); describe()
   returns it; each member's "Your projects" entry for it says, first under its name: "A test project: do only what
   you are asked here. Add no tasks, plans or posts of your own."
2. engine/assigner.js goalProject: no goal nudge for a test project. pick() is unchanged, so its tasks still go out.
3. server.js PUT /api/project/<id>: carries testOnly; a change re-tells the members (syncAgent), as a pause does.
4. install/kosmos and tools/windows/kosmos-cli.js: `kosmos project test <project-id> on|off`, through the route pause
   uses. An older board that drops the field is said, not claimed.
5. engine/projectview.js: `project show` says when it is on.

Rejected: a description only; reusing pause (it stops task hand-outs); a screen toggle in this cut.
Weakest premise: that the goal nudge is the main source of agents' own plans. The instruction line covers the rest,
but only as an instruction.

Review round 1: a running agent re-reads its instructions when its project becomes a test project (rulesChangedIn);
an agent's change is said in the room; a test project's entry leaves out the lines that invite new tasks; the
instructions teach the verb where they teach pause; the goal give-up and goal read skip a test project.

Review round 2: turning it off also owes a running agent a re-read (as a resume is told). Who may set it: the person or
any agent, on or off; the testers are agents and turn it off after a test, and every change an agent makes is said in
the room (a note row, which types into no pane). Membership is not checked, as for pause. The page does not show the
flag yet: the person sees it through the room note and `kosmos project show`.

Tests: cli.project-test-8236.test.js. Perturbed: the Assigner skip, the instruction line, the re-tell, the Mac
CLI's field; each turned a test red.
