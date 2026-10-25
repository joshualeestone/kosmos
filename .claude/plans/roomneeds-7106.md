# roomneeds-7106: the room's needs-you notice as the board's (a slice 9 gap, #6838)

**Done when:** in an iPhone project room, the pinned needs-you notice counts exactly the members the projects route
counts for this project (needsYouHere), gives each the board's reason and action (Answer or Open) and Dismiss through
the board's route with its two sentences; tested against a captured projects answer and pinned to the board; merged.

## Decisions
- Who counts: the route's needsYouHere, as the board's pjNeedsNotice. The old rule (the agent card's tone) could be
  about another project, and missed an agent whose card says working while Kosmos keeps restarting it (the captured
  answer has exactly that: eli, crash_loop).
- The words: PJ_NEEDS_WHY carried over whole (Board.needsWhy), each pinned against web/index.html; an unknown reason
  is the board's other. The head: "<Name> needs you on this project." / "N agents need you on this project."
- Dismiss: POST /api/project/<id>/needs-dismiss with {agent, reason}, the reason being needsYouKey (built as the engine
  builds it when absent). Then the list is read again, and the line under the notice says the board's sentence.
- Names: the status card's, as the rest of the app shows them, falling back to the route's.
- The phone's shape: with one member, its reason and buttons sit under the head, which already names it (#6483).
  With several, the head shows how many and Show lists them, so the pinned band never takes over the room. The board
  lists them all; a pinned band on a phone cannot.
- The project list now follows the 5-second status poll while a room is open too (it did only while the list was the
  screen shown), so the notice is current; the board re-reads its projects while a room is on screen.
- Not here: the board's "Also waiting on you:" rows (redHere), which the phone has no rows to compute.
- The capture: ios/LogicTests/room/projects-needs.json, from engine/projects.list in a sandboxed engine with real fleet
  cards, a real self-report question and a crash loop in a live room.
- Weakest premise: the band's look with several members, and Dismiss through the relay, are unverified on a screen
  (the simulator shot run is not permitted here, #7055).

## Steps
1. Parse, notice, dismiss, view, suite, build. DONE: room 257/257 (control: counting members without needsYouHere
   turns three checks red); route check 5/5; run 1209, actions 99, settings 42, tasks 90, taskpage 108; Debug build
   SUCCEEDED (the one slow-expression warning is TasksView.swift:118, main's code, 105 ms).
2. Review loop. 3. Validation, PR.
