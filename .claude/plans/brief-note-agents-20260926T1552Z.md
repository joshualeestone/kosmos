# brief-note-agents: the "no brief yet" note is for agents, not the person's room

Assigned by Liu Kang (m1089), from Kano's state 7. Follows #2707, which introduced the note.

## Problem
A new project staffed with agents and given no description gets one room post, in Kosmos's voice:
"This project has no brief yet ... ONE of you ask here what the goal is ... One question to the operator, not
seven." (`engine/projects.js` BRIEF_PENDING_NOTE, posted by `server.js` POST /api/projects through
`messages.roomNote`). It is addressed to the agents, but the page draws every note, so the first thing a person
sees in their new room is instructions written for someone else.

## Who reads it (decided from the code)
- Agents read a room through `kosmos room`, which asks the server for `?as=text` (install/kosmos, cmd_room). The
  note exists so they coordinate (#2707: seven agents, seven identical questions). They must keep seeing it.
- The page reads the same route as JSON and draws each `kind: 'note'` row in the Kosmos band (pjRoomRow).
- Nothing else reads note rows (grep: the validator, the room route's two arms, the page's renderer and its
  not-speech set).

So the note stays, and only the person's view drops it. Rendering a person-facing empty state needs no new copy:
when the room has nothing else, the page already says "Nothing here yet. Post below and everyone on this project
receives it; use @name to hand someone a request."

## Done looks like
A new project with agents and no description: its room on the page shows the existing "Nothing here yet" empty
state and no agent instruction, while `kosmos room` (the `?as=text` view) still prints the note. A room that
already holds the old, untagged note (written before this change) also hides it from the person.

## Change
1. `messages.roomNote(projectId, text, { audience: 'agents' })`: an optional audience, recorded on the row.
2. `server.js` POST /api/projects posts BRIEF_PENDING_NOTE with `audience: 'agents'`.
3. The room route's JSON arm (the person's view) leaves out notes for agents: `audience === NOTE_AUDIENCE_AGENTS`
   (exported by engine/messages.js), or a note whose text is in the frozen BRIEF_PENDING_NOTES_BEFORE_AUDIENCE (rows
   written before this change carry no audience). The text arm
   (the agents' view) is unchanged.
4. A gated browser check: create the project through the real route, open its room, assert the empty state and no
   note; read `?as=text` and assert the note is there. Control: the JSON arm's filter removed reds it.

## Rejected
- Filtering in the page instead of the server: the JSON route is the person's view, so filtering there keeps any
  future page reader (a preview, a notification) from drawing it too, and the page needs no change at all.
- Rewording the note for both audiences: it has to tell agents to hold, which is not something to show a person.
- A new empty-state sentence: the existing one already says what happens next.

## Weakest part
Old notes are recognised by their exact text, kept as a frozen copy (BRIEF_PENDING_NOTES_BEFORE_AUDIENCE, pinned by
its sha256 in the test), so rewording BRIEF_PENDING_NOTE cannot bring them back. A room holding some OTHER untagged
agent instruction written before this change would still show it; only this one note is known to exist. The person
now sees a plain empty room with no word that their agents are waiting for a goal; a person-facing line for that
could be a follow-up.
