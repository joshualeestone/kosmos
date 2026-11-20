# feedbackptr-8735: #8735 slice 3, item 3 (the daily feedback routine)

Proposed on kosmos#8735 (comment 7027148803) before building.

## Why
"Once a day: help make Kosmos better" (about 1,650 characters) is in the Project Manager role only (`engine/roles.js`),
and since #7374 the board types the whole routine into one agent a day, Project Manager first
(`engine/feedbacknudge.js` nudgeText): the questions, the commands, the names and secrets rule. Two copies of one fact.

## Change
- `engine/roles.js`: the PM section keeps that the ask comes (PM first) and is about Kosmos itself, "when it asks you,
  do it", the no usernames / agent names / project names / secrets rule (safety text, as slice 1 kept the community
  safety rules), and the sent-to-the-team sentence. The questions and commands go.
- `engine/feedbacknudge.js`: question 4 takes Josh's #3563 wording in full ("what went well, what was bad or ugly, how
  tasks are being used, and anything that is stuck. Describe tasks, do not count them: no task tallies, and no task
  titles or what a task says"), since the ask is now the one copy; it had a shortened form. Comments updated.
- `engine/feedback-triage.js`: FORM_QUESTIONS is now held equal to the ask, not roles.js (comment and test).

## Tests
`roles.feedback-2037b.test.js`: the PM brief is pinned on what it keeps; #2037's questions and #3563's wording are
pinned on nudgeText; the PM-only sweep keys on the section heading, with its control. `feedback-triage.test.js`: the
drift check reads nudgeText. Perturbed: "bad or ugly" removed from the ask -> red; the names rule cut from the brief
-> red; restored -> green.

## Measured
pm brief 51,610 -> 50,365 (1,245). Other roles unchanged; director is 49,337, so the next slices must cut across roles.

## Decided
The one behaviour change: the board asks only while sending is on (#7374), so a PM on an install with sending switched
off no longer writes a local daily report from its brief. Taken as consistent with #7374's own rule (an install that
said no is not spent a turn on a report it will not send). Weakest premise: nobody reads local-only reports from such
installs. What would change my mind: a triage or support path that does. Rejected: a `kosmos feedback --how` verb (a
third copy of a routine the board already delivers).
