# roomworking-7080: the room's grouped "is working" line (a slice 9 gap, #6838)

**Done when:** on the iPhone, a project room shows the board's grouped working line above its composer (dots and
names, no faces, the word "working"), for exactly the members the board's paintRoomBusy would show, in the room's
member order; the suite covers it against a captured real status row; it is merged.

## Decisions
- The board's rules, not new ones (web/index.html paintRoomBusy): working AND stateProject == this project (an
  unattributed working agent shows in no room, #2882); the room's member order; one grouped line with the serial
  comma for three or more; the verb "working" (WORKING_VERB), never "typing"; an agent whose post reached the room
  after the status read is left out until the next status read (#1150).
- Agent gains stateProject (BoardLogic.swift, one additive field at the end; status.js already sends it). Angel told
  first (#7074 is in BoardLogic's neighbourhood).
- "Spoke after the status read": RoomStore.spokeAt records when a room read brings a new post from an agent
  (Board.newSpeakers), never on a room's first read, so opening a room does not hide everyone until the next status.
  The status time is BoardClient.updatedAt.
- The dots are still when the person asks for less motion; they are hidden from VoiceOver, which reads the line.
- The suite reads status-working.json, a real /api/status row captured from a sandboxed board for a working fleet agent
  (unattributed, as the fleet gives it); attributed cases set stateProject on that same real row, as
  server.todayreason-7030.test.js does. The board's own source is checked for each rule and word.
- Fixes RoomView's header comment, which already claimed the line.
- Weakest premise: the look is unverified by a screenshot (the simulator run is not permitted here, #7055).

## Steps
1. Model, store, view, suite, builds. DONE (room 172/172; run 1152, actions 99, settings 42, tasks 90; route check 5/5;
   Debug and KOSMOS_STORE_SHOTS Release SUCCEEDED; controls: no project filter, no serial comma, each red).
2. Review loop. 3. Validation, PR.
