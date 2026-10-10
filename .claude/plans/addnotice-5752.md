# addnotice-5752: a refused task write shows in the project's room, with an add button (slice 3 of #5752)

Card: joshualeestone/kosmos#5752 (decision comment, night shift 2026-10-10). Stacked on memberfix-5752 (#5758, slice 2).

## Why
Slice 2 tells the AGENT how to ask to be added. The person still could not see the refusal unless the agent said so.

## Change
- engine/messages.js: `logRoomRefusal({ from, project, because, doing, addable })`, the room's refused row (#315),
  once per sender, project and reason in the window. The room post's refusal now goes through it; a stranger's post
  refusal is `addable` (a removed agent's is not: adding it again would not help).
- server.js: every refused task WRITE for not being on the project logs that row with what the agent tried
  (`doing`: add a task, close/reopen a task, change a task, move a task, record a run of a task, set how often a task
  repeats, mark a task built, write in a task, set its role here) and `addable`. Reads are not logged (noise). The row
  holds the bare sentence, never the agent-directed fix. The room route passes `doing` and `addable`; the agents' text
  view of the room says "<agent> tried to <doing> here".
- web/index.html: a refused row says what was tried ("tried to post here" when nothing is said, as before) and, when
  `addable` and the agent is still not a member, shows "Add <name> to this project". It calls the Members add
  (`addMemberToProject`) and repaints, which drops the button; a refusal says why on the row. Addable rows are not
  folded, so each keeps its own button.

## Tests
- server.task-repeat-4787.test.js: five refused writes give five rows (one for a repeated refusal) with `doing`,
  `addable` and the bare sentence, through GET /room; the text view's words; a member's run leaves none.
- web.post-receipt.test.js (the real pjRoomRow and pjFoldRoomRows): the words and the button; no button for a member
  or a non-addable row; addable rows are not folded, plain ones still are; the click wiring.
- server.agent-projects-4491.test.js / engine/messages.test.js: a stranger's post row is addable, a removed agent's
  is not.
- 14 mutants: 13 caught by a red test; removing the fold's outer addable check makes the fold loop forever (caught as
  a hang, the run killed; a node test timeout cannot interrupt a synchronous loop).

## Weakest premise
That a person seeing "Add zed to this project" in the room wants that agent there. The row says what it tried and
why it was stopped; the person decides. The add is the same call as the Members "+", with its existing valve.

## Not covered
- Design review and screenshots (the design-shots skill) are owed before merge: a new button on a room band.
- A gated browser check for the button is not written; the page functions are tested.
