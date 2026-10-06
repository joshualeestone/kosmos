# pauseask-5320: #5320 part 2, an unsure agent asks and points at the Pause button

## Why
#5320's report: an agent that heard its person pause a project could only choose blocked (inert) or needs_you (a red
light with no action). The card asked that the agent "can set the board's pause, or ask the person to with one click".
Setting it shipped in 0.7.22 (#4982). The one click is Mona's #5391 (PR #5395): a Pause / Resume button beside the
project's name, at the top of the page the room sits on. So part 2 is not a new room message kind with its own button
(rejected: a new interaction surface and an authority path triggered by agent-written content); it is one instruction.

## Change (engine/projects.js blockRules().member)
- "If you cannot tell whether they mean the whole project, ask them in the room; they can also press Pause beside the
  project's name themselves."
- The resume pointer names the button: "tell them to press Resume beside the project's name, at the top of its page"
  (was "tell them it is on the project's page").
- Delivery: part 1 (#5409, merged) owes every running member a re-read when a rule is added, so running agents learn
  this without a restart.

## Ordering
Do NOT merge before #5395: the line names a button that only exists once it lands.

## Tests
engine/projects.test.js "#5320 part 2": both sentences present, the old pointer gone. Red against main's projects.js.
projects + instructionreread tests 188/188.

## Weakest premise
That "beside the project's name" stays true: if #5395's button moves before it merges, this wording moves with it.
