# onhold-4771: a task on hold and a paused project are skipped by the Prompter and the Assigner (kosmos#4771)

A real user's team (relayed by Josh, #admin, 2026-09-30 14:35): the Prompter (#4544, engine/agentnudge.js, the nudge
to an idle AGENT) and the Assigner (#4552, engine/assigner.js) cannot tell held work from real work, so they pushed
agents onto tasks the person had put on hold and into a project the person had paused.

## What changes
- engine/tasks.js: `isOnHold(t)` / `setOnHold(projectId, n, onHold)`. Stored as `onHold: true`, absent when off, so
  every task written before reads as not held. Activity records `hold-set` / `hold-cleared`.
- engine/projects.js: `paused` on the record (absent = not paused), set through `edit`, `isPaused` / `setPaused`.
- engine/agentnudge.js (the Prompter): a paused project's tasks and a held task are not the agent's work to nudge
  about. engine/assigner.js: neither is handed out, and neither keeps an agent busy.
- server.js: `POST /api/project/:id/task/:n/hold {onHold}`; `paused` on the project edit (PUT).
- web/index.html: a hold toggle on the task page (Put on hold / Take off hold, with a hint that says when the whole
  project is paused), Pause it / Resume it in the project's settings, and an On hold tile and group on the Tasks view.
- CLI: `kosmos task hold|unhold` in install/kosmos and tools/windows/kosmos-cli.js, so a lead agent can hold a task
  itself instead of labelling it by hand.
- Browser checks: render-onhold-4771.js (new, gated); render-tasks-view-3559.js now knows the seventh tile.

## Decided (on the card, overridable)
- Held work is skipped by BOTH automations; a held task stays on its owner's list for everything else.
- No setting: on hold is a state on the task or project, not an automation option (the card's own call).
- Held work does NOT keep an agent busy for the Assigner, so an agent holding only held tasks can be given real work.
  Rejected: counting held tasks as busy, which would leave that agent idle for as long as the person keeps it parked.
- A held task still counts as open work for the project's goal ask (the project is not empty; the person parked the
  task, so the goal is not put to an agent). A paused project is not asked about at all.
- Holding is NOT a person-only act: an agent may hold a task through the CLI (the user's lead agent was doing this by
  hand with labels). The task's activity records who did it: the person on the screen, or an agent ("Put on hold by an
  agent"), from the same screen-or-process test the built mark uses. Rejected: refusing agents, which removes the one
  tool a lead agent asked for. Also rejected: naming the agent, which needs the built route's token and pane
  resolution; a follow-up if people want the name.
- `kosmos task list` marks held work "[on hold]" (the task's own hold or its paused project), so an agent can see it.
- The On hold tile sits after Josh's five open groups and before Completed; his order is otherwise unchanged.
- Its colour is --k-ink-2, Unassigned's neutral: both mean nothing is moving, and the label and icon tell them apart.
- A paused project holds every task in it on the Tasks view (they count under On hold), and resuming brings them
  back; the tasks' own onHold flags are untouched by a pause.

## Weakest premise
That skipping held work in the Assigner's busy count is what the person wants: an agent whose only work is held is
treated as free and may be given something new. If people read "on hold" as "this agent is reserved for it", the
busy rule flips (one line in engine/assigner.js).

## Checks
- engine/onhold-4771.test.js (Prompter and Assigner skip held and paused work, each against a control that is not
  held); server.test.js (the hold route); tools.windows-kosmos-cli-570.test.js (the CLI verbs); the Tasks-view and
  web suites.
- Browser: render-onhold-4771.js 34/34; render-tasks-view-3559.js 294/294; the two surface-flagged checks run and pass.
