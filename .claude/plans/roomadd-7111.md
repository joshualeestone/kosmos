# roomadd-7111: the Add button on an addable refusal in the iPhone room (a slice 9 gap, #6838)

**Done when:** in an iPhone project room, a refusal the board offers Add on (addable, not a member, an agent this
computer still has) offers "Add <name> to this project", which adds through the board's route with the board's words
and focus; tested and pinned to the board; merged.

## Decisions
- The board's rule (web/index.html pjRoomRow 'refused': `m.addable === true && !onIt && live`) as Board.addMemberShown,
  against the room's members from the project list (it follows the status poll while a room is open, so the button
  goes once the agent is a member) and the agents in the status (the board's `live`).
- The project list now follows the status poll while a room is open (ProjectsView; it did only while the list was the
  screen shown), so the button goes once the agent is added from elsewhere (review 1). The same one-line change is in
  #7106's branch; identical edits rebase cleanly.
- POST /api/project/<id>/agent/<session> (addMemberToProject). The phone's requests already say same-origin (#7075),
  which is what the route's isViaScreen reads, so it is recorded as added from the screen.
- Added: the list and the room are read again; VoiceOver hears "Added <name> to this project." and focus goes to the
  box, only while the room is on screen (the board's PJ_CURRENT check). Refused: the route's error as a sentence
  (Board.sentence, the board's pjSentence), else the board's "We could not change that project.", beside the button;
  the button waits while in the air and can be pressed again. A refusal is also heard (the board's role=status).
- KOSMOS_SAMPLE_REFUSAL=1 (Debug) adds an addable refusal by Farah to the sample room, for the Add shots.
- Layout: the button on its own line under the refusal sentence, 44 pt, a quiet capsule (the board's pj-refused-act).
- The route check (server.ios-routes-6838, mine from #7061) judged a route ending in a placeholder against a sibling
  that only named another agent on the same route, so it called this route gone. Its made-up sibling now replaces the
  part before a trailing placeholder; two controls pin both directions.
- Weakest premise: the look and VoiceOver landing are unverified on a screen (#7055).

## Steps
1. Logic, store, view, tests. DONE: room 261/261 (control: dropping the `live` check is red); route check 5/5 with
   the two new controls; run 1209, actions 99, settings 42, tasks 90, taskpage 108; Debug and Release SUCCEEDED.
2. Review loop.
   - Round 1: 0 blockers, 2 warnings, 2 nits. Fixed: the list follows the status poll in a room; a refusal is heard;
     liveMembers is the room's live project; a sample addable refusal for the shots.
   - Round 2: 0 blockers, 0 warnings, 2 nits. Fixed: a 2xx this build cannot read is a refusal, never an add (tested);
     the route check's comment names the task-tail routes it also covers. Recorded: the sample room's Add is not
     short-circuited, so the shots show the button and the refused line, not the added state. Converged.
3. Validation, PR.
