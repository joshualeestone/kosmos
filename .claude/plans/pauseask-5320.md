# pauseask-5320: #5320 part 2, an unsure agent asks and points at the Pause button

## Why
#5320's report: an agent that heard its person pause a project could only choose blocked (inert) or needs_you (a red
light with no action). The card asked that the agent "can set the board's pause, or ask the person to with one click".
Setting it shipped in 0.7.22 (#4982). The one click is Mona's #5391 (PR #5395): a Pause / Resume button beside the
project's name, at the top of the page the room sits on. So part 2 is not a new room message kind with its own button
(rejected: a new interaction surface and an authority path triggered by agent-written content); it is one instruction.

## Change (engine/projects.js blockRules().member)
- The pause line and its consequence stay together ("the room is told you paused it" is true of the agent's pause,
  not of a press on the screen: review 3). The resume pointer names the button: "tell them to press Resume beside the
  project's name, at the top of its page" (was "tell them it is on the project's page").
- Then: "If you cannot tell whether your person means the whole project, ask them in the same place they asked (they can
  also press Pause beside the project's name, at the top of its page), and pause it if they say yes. If they mean only
  some tasks, put those on hold: `kosmos task hold <project-id> <task-number>`."
  Review 1: not "in the room" (the request can come directly). Review 2: say what to do on a yes. Review 3: the Pause
  pointer is given while asking (afterwards the button reads Resume), "your person" not "they", and some-tasks has a
  verb. Review 4: a press on the screen is not announced to the room, so the agent is told nothing more is needed if
  they press it; and a plain no means leave it. Review 5: the Pause pointer is an instruction ("tell them"), not an
  aside; the branches run yes / nothing / some tasks so "no, just tasks 3 and 4" has one reading; "the room is told
  you paused it (unless it already was)" (server.js posts only on a change); and the idle nudge (engine/agentnudge.js)
  no longer says "asked in the room", which contradicted "the same place they asked". Review 6: the branches hang off
  "When they answer:", so the agent waits; "if they pressed it, nothing more is needed" is one of them.
- Delivery: part 1 (#5409, merged) owes a running member a re-read when its block is next rewritten (a task or
  membership change) and the rule is new there. Until then it keeps the old pointer ("it is on the project's page"),
  which is still true.

## Ordering
The PR says so in its body: its merge-order test is red BY DESIGN until #5395 is on main; after #5395 lands it needs
a fresh CI run on the new main (/fresh-ci), not a re-run.
Do NOT merge before #5395: the line names a button that only exists once it lands. ENFORCED by a test (review 1): it
reads web/index.html for id="pj-head-pause" within 600 bytes after id="pj-one-name" (beside the name), and checks
paintHeadPause alone (to its closing brace; review 3) names it with 'Pause' and 'Resume' (review 2: not one pinned line), so it is red on main until #5395 lands and
red again if the button is ever removed or renamed.

## Tests
engine/projects.test.js "#5320 part 2": both sentences present, the old pointer gone. Red against main's projects.js. On this branch (main underneath) the merge-order test is the one expected red; on a
tree with #5395 merged in, engine/projects.test.js is 162/162.

## Known limit
The button is hidden on an archived project; agents are not told about archived projects, so the line is not reached
there.

## Weakest premise
That "beside the project's name" stays true: if #5395's button moves before it merges, this wording moves with it.
