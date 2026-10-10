# memberfix-5752: a refusal for not being on the project names its fix (slice 2 of #5752)

Card: joshualeestone/kosmos#5752 (decision comment, night shift 2026-10-10). Slice 1 (dailytimes-5752) is separate.

## Change
- server.js: `NOT_ON_PROJECT_FIX`, appended to every refusal of an agent's OWN action on a project it is not on: the
  shared `notOnProjectRefusal` (task add, close/act, change, move), the repeat/ran route, the built mark, a task
  message, the task read and the room read. The sentence keeps its start, so callers matching the start still match:
  "that agent is not on this project, so it cannot <verb>; ask the person to add this agent with Add member on the
  project's page, then run the same command again".
- Not changed: refusals about giving a task or part to ANOTHER agent (engine/tasks.js), whose fix is different, and
  the 404/409 "that agent is not on this project" answers of the membership routes themselves.

## Why not add the agent automatically (the card's first option)
Kosmos does not start scheduled work, so there is no placement step to hook. Adding on the refused write would let any
agent join any project by writing to one of its tasks; membership is the gate that keeps a project to its team. The
person stays the one who adds members, and the agent is now told exactly how to ask.

## Tests
- server.task-repeat-4787.test.js: the full sentence for a rule and a run by a non-member, then one arm per write site
  (add, built, message, run), with a member's run as the control.
- server.agent-reads-4491.test.js: the full sentence for the task read and the room read (text arm, exact).
- Each of the six sites was removed in turn and its arm went red.

## Weakest premise
That "Add member on the project's page" is where the person adds members on every surface they use. It is the
button's own words (web/index.html #pj-add-member, "+ Add member"); the Kosmos+ phone view was not checked.

## Not covered
- Slice 3: a notice on the person's board where the refusal happened, with an Add as member button.
