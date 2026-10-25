# roomattach-7093: the + to add a photo or file to a room post (a slice 9 gap, #6838)

**Done when:** on the iPhone, a project room's + adds photos or files that upload to the Mac at once and wait as
chips, and Post carries their ids with the words (or their names alone), as the board's room does; the request shapes,
limits and words are tested against the board's source; it is merged.

## Decisions
- The board's room attach (web/index.html ATTACH_ROOM, attachUpload, pjPostSend): PUT /api/project/<id>/attachment,
  then the room's post with `attachments: [ids]`; files alone post their names (after a Reply's @name when that is
  all the box holds); the files leave the box only once the post is kept. Each pinned against web/index.html.
- Reuse, not copy, of Angel's chat upload (#7071, PR #7073): BoardClient.attach takes a key and a request, so the
  room's files wait under Board.roomAttachKey(project) ("room:<id>", which no agent name can be) through the same
  limits, sentences, copying and forgetting. The chat's own entry point is unchanged and its suite (run.sh) is green.
  Board.uploadRequest(mac:path:...) is the shared builder; the room's route lives in BoardRoom.swift because three
  suites compile BoardClient without it.
- The +, chips and pickers in RoomView follow the chat's (ChatView) shape. They are written in RoomView rather than
  extracted from ChatView because Angel's #7089 is open in ChatView; extracting a shared view is a follow-up once it
  lands. The +'s VoiceOver label is the board's "Add a file to this conversation".
- Post waits while a file is still on its way, as the chat's Send does. The files leave the chips at the press, as
  the chat's do, and come back in front of any added since when the post is refused or not confirmed; a
  not-confirmed post a read shows kept takes them off again (review 1: leaving them on the chips until the answer let
  a second press, or the next post, carry them twice; the board refuses a second send while one is in the air).
- The file-refusal line is grey, as the chat draws it.
- Not here: dropping files onto the thread (no phone equivalent).
- Weakest premise: the look, the pickers and a real upload through the relay are unverified on a screen or a device
  (the simulator shot run is not permitted here, #7055). Built on roommention-7085, so it rebases after #7085 merges.

## Steps
1. Shared upload, store, view, suite, build. DONE: room 224/224 (controls red: attachments dropped from the body, the
   Reply @name lost from a files-only post); run 1195 (the chat's upload tests), actions 99, settings 42, tasks 90,
   taskpage 108; Debug build SUCCEEDED, no slow expressions.
2. Review loop.
   - Round 1: 1 blocker, 0 warnings, 2 nits. Fixed: files off the chips at the press, back on refused or unsure
     (BoardClient.reattach, tested in run.sh: front of the list, never twice, control red); a not-confirmed post a
     read shows kept takes its files off; the grey line. run 1197/1197, room 224/224; Debug build SUCCEEDED.
   - Round 2: 0 blockers, 2 warnings, 1 nit. Fixed: the ten count the files of this room's posts still in the air
     (Board.roomFilesCounted, in RoomStore.attach, atFileLimit and the photo picker's count), so a refused post can
     never leave more than ten; the come-back decision is Board.roomFilesAfter, tested on every answer (its wiring in
     RoomStore.post is checked by reading: ProjectsView is in no suite); files a post put back are not announced as
     added. Room 230/230 (controls red: unsure-but-kept brings them back, in-air not counted); run 1197; Debug OK.
3. Validation, PR (after #7085 merges and this is rebased).
