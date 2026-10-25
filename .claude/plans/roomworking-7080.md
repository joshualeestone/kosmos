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
- With Reduce Motion the dots still fade, slower (the board's work-fade, #4591; round 2); they are hidden from
  VoiceOver, which reads the line.
- The suite reads status-working.json, a real /api/status row captured from a sandboxed board for a working fleet agent
  (unattributed, as the fleet gives it); attributed cases set stateProject on that same real row, as
  server.todayreason-7030.test.js does. The board's own source is checked for each rule and word.
- Fixes RoomView's header comment, which already claimed the line.
- Weakest premise: the look is unverified by a screenshot (the simulator run is not permitted here, #7055).

## Steps
1. Model, store, view, suite, builds. DONE (room 172/172; run 1152, actions 99, settings 42, tasks 90; route check 5/5;
   Debug and KOSMOS_STORE_SHOTS Release SUCCEEDED; controls: no project filter, no serial comma, each red).
2. Review loop.
   - Round 1 (fresh blind reviewer): 0 blockers, 2 warnings, 5 nits. Fixed: the #1150 comparison moved into
     Board.spokeSince and tested before/equal/after/no read (W1); no line while status reads are not landing,
     client.fresh, a deliberate under-claim where the board keeps its last line (W2); the speakers test asserts
     ["cleo", "eli"] and no longer claims a guard it cannot test (N1); the line sits above the held notice, as
     #pj-busy above the composer #pj-held tops (N2); names bold, as the board's <b> (N3); the dots read their
     opacity from a TimelineView, so Reduce Motion off again restarts them (N5); the sample status gives Dana the
     sample room's project, so screenshots show the line. Not taken: N4 (members can go stale while a room is open)
     predates this branch. Room 178/178 (controls: >= for > red, names unmarked red); run 1152, actions 99,
     settings 42, tasks 90; route check 5/5; Debug (no slow expressions) and KOSMOS_STORE_SHOTS Release SUCCEEDED.
   - Round 2 (fresh blind reviewer): 0 blockers, 3 warnings, 6 nits. Fixed: the line now needs the phase live AND
     fresh, as the Agents tab decides "not updating" (W1: fresh alone stays true while unreachable); the new-post test
     uses a baseline where cleo already spoke and asserts ["eli"] (W2, the "every speaker is new" mutation now red);
     the dots keep fading under Reduce Motion (1.6s, 0.35 to 1, the board's work-fade, #4591) (W3); a page the computer
     could not read (ok:false) is never a baseline for who spoke next (N1, the board's body.ok !== false); 30 frames a
     second at most (N5). Recorded, not changed: stamps are kept per room and a new post is found by a new id, where
     the board keys by speaker and compares `at` (N3, both safe, per-room is the board's own named improvement); the
     dots are grey and fade-only as the phone's chat line, not the board's green rising dots (N4); RoomStore stamps
     with Date() while updatedAt uses env.now(), the same clock outside tests (N6); the stamping order inside
     loadRoom is not compiled by the room suite (N2, a comment pins that `before` is read first). Room 182/182
     (controls red: every-speaker-new, unread ignored); run 1152, actions 99, settings 42, tasks 90; route check 5/5;
     Debug and KOSMOS_STORE_SHOTS Release SUCCEEDED.
   - Round 3 (fresh blind reviewer): 0 blockers, 2 warnings, 2 nits. Fixed: the baseline set is only ever added to,
     as the board's ROOM_SPOKE_SEEDED (W1: removing it on a later unreadable read left the next reply unstamped);
     the byPerson guard is commented as backup for parseRoom, not claimed by a test (N1). Recorded, not changed:
     the status time is when the answer lands, not when it was asked (W2), exactly the board's LAST_AT; a phone's
     longer round trip widens the window in which a reply shows above its own "is working" for one poll, the
     direction the board accepts, and fixing it means a new stamp inside BoardClient.refresh, shared code, for a
     one-poll over-claim. After a long stay in the background the line can show the last status until the next
     status read (N2); a time-based age check would not redraw on its own, and this is already stricter than the
     board, which keeps its line through any outage.
   - Round 4 (fresh blind reviewer): 0 blockers, 1 warning, 3 nits. Fixed: a reader at the end of the room stays
     there when the working line comes, goes or grows (W1, the board's holdFloorOnResize, #1037); the stamping moved
     into Board.stampSpeakers and is tested in loadRoom's order (first read, unreadable read keeps the baseline, the
     reply after it is stamped), which replaces round 2's N2 note (N1); the dots scale with text size and sit on the
     first line's baseline (N2); a vacuous empty-dictionary assertion removed (N3). Room 186/186 (controls red:
     unbaselining on an unreadable read, a baseline before any real read); run 1152, actions 99, settings 42, tasks
     90; route check 5/5; Debug and KOSMOS_STORE_SHOTS Release SUCCEEDED.
   - Round 5 (fresh blind reviewer): 0 blockers, 0 warnings, 1 nit, fixed: the hold's scroll is animated, as the
     new-row scroll is, so a reply landing with its writer leaving the line slides in rather than jumping.
   - Round 6 (fresh blind reviewer, on the rebase onto origin/main): 0 blockers, 0 warnings, 2 nits, both comments:
     the ok:false guard is said to cover only a computer older than paged reads (a current one answers 503, which
     never reaches the stamping), and the Decisions line about Reduce Motion now says the dots fade. No behaviour
     changed, so the loop converges here. After the rebase: room 186, run 1152, actions 99, settings 42, tasks 90,
     taskpage 108; route check 5/5; Debug and KOSMOS_STORE_SHOTS Release SUCCEEDED.
3. Validation, PR.
