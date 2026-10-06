# pauseask-5320: #5320 part 2, an unsure agent asks and points at the Pause button

## Why
#5320's report: an agent that heard its person pause a project could only choose blocked (inert) or needs_you (a red
light with no action). The card asked that the agent "can set the board's pause, or ask the person to with one click".
Setting it shipped in 0.7.22 (#4982). The one click is Mona's #5391 (PR #5395): a Pause / Resume button beside the
project's name, at the top of the page the room sits on. So part 2 is not a new room message kind with its own button
(rejected: a new interaction surface and an authority path triggered by agent-written content); it is one instruction.

## Change (engine/projects.js blockRules().member)
- Right after the pause line: "If you cannot tell whether they mean the whole project, ask them where they asked, and
  tell them they can also press Pause beside the project's name themselves." (review 1: "where they asked", not "in the
  room", since the request can come directly; placed after the pause line so "they" is the pause request)
- The resume pointer names the button: "tell them to press Resume beside the project's name, at the top of its page"
  (was "tell them it is on the project's page").
- Delivery: part 1 (#5409, merged) owes a running member a re-read when its block is next rewritten (a task or
  membership change) and the rule is new there. Until then it keeps the old pointer ("it is on the project's page"),
  which is still true.

## Ordering
Do NOT merge before #5395: the line names a button that only exists once it lands. ENFORCED by a test (review 1): it
reads web/index.html for id="pj-head-pause" and the Pause / Resume label, so it is red on main until #5395 lands and
red again if the button is ever removed or renamed.

## Tests
engine/projects.test.js "#5320 part 2": both sentences present, the old pointer gone. Red against main's projects.js.
projects + instructionreread tests 188/188.

## Weakest premise
That "beside the project's name" stays true: if #5395's button moves before it merges, this wording moves with it.
