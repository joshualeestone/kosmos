# addnotice-5752: a refused task write shows in the project's room, with an add button (slice 3 of #5752)

Card: joshualeestone/kosmos#5752 (decision comment, night shift 2026-10-10). Stacked on memberfix-5752 (#5758, slice 2).

## Why
Slice 2 tells the AGENT how to ask to be added. The person still could not see the refusal unless the agent said so.

## Change (the rules as they stand; the round sections below record how they got here)
- engine/messages.js: `logRoomRefusal({ from, project, because, doing, addable })` writes the room's refused row (#315).
  An `addable` row is ONE per agent and project in the window, whatever was tried; any other row is one per reason and
  `doing`. No sender, no row. The room post's refusal goes through it: a stranger's post refusal is `addable` only when
  the live post route named the sender by its agent token (`senderByToken`); a removed agent's, a pane claim's and an
  outbox replay's never are.
- engine/messages.js: the room's hold refusal dedups only against earlier HOLD refusals (`ROOM_HELD_REFUSAL`).
- server.js: every refused task WRITE for not being on the project logs that row, with what the agent tried (`doing`:
  add a task, close/reopen a task, change a task, move a task, record a run of a task, set how often a task repeats,
  mark a task built, write in a task, set its role) and `addable` only when processCaller says `byToken`. Reads are not
  logged. The row holds the bare sentence, never the agent-directed fix. The room route passes `doing` and `addable`;
  the agents' text view says "<agent> tried to <doing> here".
- web/index.html: a refused row says what was tried ("tried to post here" when nothing is said). An addable row whose
  agent is a live board agent and not yet a member shows "Add <name> to this project": pjRefusedAddClick pins the
  project, calls the Members add, then (if still on that project) repaints the room, announces the add and focuses the
  composer. Rows with `addable` or `doing` are never folded; the fold's inner loop starts past the row it admitted, so
  it always moves on. Room search matches `doing` too.

## Tests (current)
- server.task-repeat-4787.test.js: one addable row for an agent refused several writes; a fresh agent per verb, each
  with its own row and `doing`; a pane-claimed refusal kept without the add; the role row's rendered sentence; a
  member's run leaves no row.
- server.agent-projects-4491.test.js: a stranger's token post is addable; the live route marks a pane-only post not
  token-named and a token post token-named.
- engine/messages.test.js: a hold refusal still logs after an unrelated refused row; the dedup rules; no sender no row;
  a pane-claimed and an outbox-style post are not addable, a token-named one is.
- web.post-receipt.test.js (the real pjRoomRow, pjFoldRoomRows, pjRefusedAddClick): words and button; no button for a
  member, a non-addable row or a deleted agent; every fold check (outer and inner, addable and doing) has a mixed
  fixture; the click: add, repaint with cache cleared, announce, focus; a refused add; a project switch mid-add.

## Fixed before review
- The first commit's test passed alone and failed in its file: earlier tests' refusals by the same agent were in the
  same window. It now uses its own project. Found with it: the dedup key left out `doing`, so a refused rule change
  hid a refused run sharing its sentence; `doing` is in the key now (mutant caught).

## Review round 1 fixes
- The room's held-refusal dedup counted ANY refused row for the agent, so a task-write row swallowed its first hold
  refusal (#315); it counts only earlier hold refusals now (#2738's fixture uses the real hold sentence).
- An addable refusal is ONE row per agent and project in the window (one agent looping through task verbs left a row
  and a button each); a plain refusal is one per reason and doing. No sender, no row.
- "set its role here here": `doing` is "set its role", and the test asserts the rendered sentence.
- Pressing Add now repaints the room (pjReload alone does not), says "Added <name> to this project", and focuses the
  composer; the handler is `pjRefusedAddClick`, driven by a behaviour test (the source-text assertion is gone).
- The button shows only for an agent this board still has (a deleted one would be added as a ghost member).
- `addable` only for a caller its TOKEN named (processCaller returns byToken; the room post checks resolvedSender): a
  pane claim is advisory, and a button on it would let one process ask in another agent's name. The row is still
  kept, without the button.
- Room search matches what was tried.
- Left as is (NIT): a deliberately removed agent's old row offers the add again.
- 11 mutants, each caught.

## Review round 2 fixes
- The outbox drain replays a kept post with a sender that may be a pane claim, and it was addable. The live post
  route alone marks `senderByToken` (only when the agent token resolved); the engine offers the add only then.
- pjRefusedAddClick pins the project it was pressed in (as pjNoticeRetryClick does): a person who moved on while the
  add ran gets nothing repainted, said or focused elsewhere, and no throw on a null project.
- A refused row that says what was tried (`doing`) is not folded either, so a band never says "tried to post here"
  for task writes.
- Per-site coverage is back: a fresh agent per verb (add, close, reopen, done-when, assign, repeat, built, message,
  role), each asserting its own row and `doing`.
- Left as is (NITs): task sites never refuse a removed agent still on the record (they admit it), so there is no
  removed-agent add to withhold there; a refused reaction is not logged as a room row.
- Mutants: 9 caught; a fold that loops on a `doing` row is caught as a hang (no node test timeout can stop a
  synchronous loop).

## Review round 3 fixes
- Two fold mutants survived (the inner loop's checks); mixed fixtures now catch all four checks.
- The fold's inner loop starts past the row the outer check admitted, so a broken check can no longer spin the page;
  the two mutants that hung are clean reds now.
- The plan's Change and Tests sections were rewritten to the current rules.
- logRoomRefusal, ROOM_HELD_REFUSAL and NOT_ON_PROJECT_FIX moved above react()'s doc comment.
- Left as is (NIT): a pane-claimed refusal and a later token-named one by the same agent and attempt leave two rows.
