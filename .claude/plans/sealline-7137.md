# sealline-7137: the line above a sealed or waiting shared room, on the iPhone

Card: kosmos#7137 (filed by me from a board-vs-phone sweep; the board's #pj-fed-own-phone, #4658 slice 2).

## What
- BoardLogic.swift: Board.fedGateMode and Board.fedShown(fromStatus:), the board's fedGateMode/fedShow() from the status
  poll's sourceChannel, federationLive and kosmos_plus (real JSON true/false only, as the board's === checks). In
  BoardLogic, not BoardRoom, because BoardClient calls it and three suites compile BoardClient without BoardRoom.
- BoardClient.swift: fedShown, set from each status read, forgotten with the Mac (forgetToday).
- BoardRoom.swift: ownCompareRequest (GET /api/federation/own-compare?project=), parseOwnCompare (a code is a non-empty
  string, pending exactly true; the code itself is never kept), ownSealLine and the two sentences.
- ProjectsView.swift (RoomStore): ownCompare by project, read after each room read and only while fedShown; any
  answer that is not a readable 200 (404 with sharing off) leaves no line; reset() forgets it.
- RoomView.swift: the line above the conversation, under the search bar, in .callout and Palette.tertiary, plain words
  (the board's .ownseal-phone: --text-callout, --label-3, a plain <p>).

## Decided (design, reversible)
- Words (final, after review rounds 1 and 2): "This room is sealed on your computer. The code to compare is on your
  computer's board, under Members." and "Your computer is waiting to be let in. The code to compare is on your
  computer's board, under Members." The board's "this computer" is the person's computer from the phone, and the phone
  has no Members code section (its Members button opens the board); "your computer's board" is how six other phone
  lines name it. The card first said the line would link
  there; the board's line is plain text and the toolbar's Members button already goes there, so plain text.
- The phone sends Sec-Fetch-Site on every request (#7075), so own-compare's isViaScreen gate lets it read; it reads
  the code only to know one exists.

## Checks so far (12:58 CDT)
- run-room 413/413, run.sh 1223, actions 99, settings 42, tasks 90, taskpage 108; route check 5/5; Debug and
  KOSMOS_STORE_SHOTS Release builds.
- Broken-copy controls: staging ignoring a real false -> red; the line without the UI gate -> red; the drawing
  deleted -> red.

## Review
- Round 1: 0 blockers, 4 warnings, 4 nits. Fixed: loadOwnCompare had been put between loadRoom's @discardableResult and
  loadRoom (four build warnings; pinned); a failed read keeps the line through two misses and drops it at the third,
  any 2xx JSON object is an answer (Board.ownCompareAfter, the board's fedOwnLoad, tested and pinned); only the newest
  read for a project writes (ownSeq, the board's FED_OWN_SEQ); entering the room starts the line empty and drops a
  read in the air (enterOwnCompare, the board's fedOwnReset). Nit fixed: the words never call the Mac "this
  computer" from the phone ("This room is sealed on your computer. The code to compare is on its board, under
  Members."); a test counted twice moved out of its loop; "follows each room read" named "that lands". Recorded: the
  Members word is on the board's card, which is where the line sends the person, not on the phone's info button.
  Decided: enterOwnCompare runs on every onAppear, also coming back from an agent's chat pushed over the room, so the
  line may be absent for one read then (the room re-reads at once). Room 423/423; every suite; both builds, no
  warnings in the changed files. Broken copies: drops at two, no seq guard, no clear on entry: each red.
- Round 2: 0 blockers, 3 warnings, 5 nits. Fixed: the read is asked with every room read, landed or not, before it is
  sent, so a room that stops reading still drops a stale line at the third miss (pinned; moving it back after a landed
  read goes red); the drawn line's gate on client.fedShown pinned (a store passing true now goes red); the words say
  "your computer's board", matching the card and the phone's other lines. Nits fixed: asked at most every 10 s, the
  board's FED_OWN_REFRESH_MS (pinned), at once on entering; a JSON array is an answer with no code, as the board's
  typeof check; the loader's comment says the phone forgets the answer while the UI is off where the board keeps it.
  Recorded: the clear on every onAppear (decided in round 1). Room 428/428; every suite; both builds, no warnings in
  the changed files.
- Round 3: 0 blockers, 2 warnings, 3 nits. Fixed: the pace is the board's fedOwnTick as a pure, tested value
  (Board.ownShouldAsk / OwnAsk): never while a read is in flight, again only 10 s after the last read FINISHED (answer
  or miss), at once the first time; the store marks a read in flight and stamps it done when it lands. A simulated
  12 s route under a 5 s room loop now lands every read and drops a stale line at the third miss (the round's
  starvation case). The two source-only pins that let the throttle and the seq be broken are replaced by behaviour
  tests; broken copies (in flight ignored, >= for >) each go red. Nit fixed: the loader comment no longer claims the
  UI coming back never draws an old answer. Recorded: the Debug sample room makes no own-compare read, so no sample
  shot shows the line (the simulator shot run is not permitted on this machine, #7055, so no shots either way); the
  onAppear clear, decided in round 1. Room 437/437; every suite; both builds, no warnings in the changed files.
