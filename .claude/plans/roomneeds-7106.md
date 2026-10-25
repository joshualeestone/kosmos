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
  builds it when absent, cut by UTF-16 units as its slice). Taken: the list is read again (twice at most), and only
  once a read shows it is the board's "Dismissed..." said, to VoiceOver, with focus on the next row's Dismiss, else the
  last one left, else the head (the board's pjNeedsDismissClick). Not taken: the board's could-not sentence is heard
  and stays under the notice until its rows change or the room opens again. The board's status line is read, not
  drawn, so a success line is never left pinned over a room.
- Names: the status card's, as the rest of the app shows them, falling back to the route's.
- The phone's shape: with one member, its reason and buttons sit under the head, which already names it (#6483).
  With several, the head shows how many and Show lists them, so the pinned band never takes over the room. The board
  lists them all; a pinned band on a phone cannot. (Mona Lisa's design call, as the design owner; Hide collapses it
  again if an opened list at a large text size crowds the room.)
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
2. Review loop.
   - Round 1: 0 blockers, 4 warnings, 4 nits. Fixed: the dismiss line no longer pinned for good (success heard,
     failure until the rows change or the room opens); VoiceOver hears it and focus moves as the board's; 44 pt
     targets inside each button's label; an account guard on dismiss; the UTF-16 fallback key; a dismiss said done
     only once a re-read lands; the sentence choice tested (Board.needsDismissSaid); the fixture called captured
     and trimmed. Room 261/261; route check 5/5; Debug SUCCEEDED.
   - Round 2: 0 blockers, 2 warnings, 3 nits. Fixed: with the last row dismissed, focus goes to the box (the head is
     gone with the notice); nothing is said or focused once the room is left, and its failure line is not kept; a
     test where the route's key differs from the built one (the parse mutation now red); Dismiss waits while its
     request is in the air. Recorded: the fallback key cannot keep a lone surrogate as JavaScript's slice does (Swift
     strings cannot hold one); the engine always sends needsYouKey, so the fallback only serves an older board; a
     code-point-safe engine key would be its own card. Room 263/263; Debug SUCCEEDED.
   - Round 3: 0 blockers, 2 warnings, 4 nits. Fixed: the Debug sample room gives cleo a question and eli a trust
     reason (the shots showed no notice at all under the new rule); focus moves after a dismiss only if VoiceOver was
     still on that Dismiss (the board's own check), and never to a row behind Hide; Answer/Open for an agent the
     status does not list opens the project's board page rather than being a dead button; the reasons pinned both
     ways (the board's PJ_NEEDS_WHY keys equal the phone's). Room 264/264; Debug SUCCEEDED.
   - Round 4: 0 blockers, 1 warning, 2 nits. The warning is an engine bug already on main, filed and fixed as #7108
     (needsDismissKey could end in half an emoji, and the phone then cannot read /api/projects at all). Fixed here:
     focus also moves when it fell to nothing with its row; Dismiss reads "Try again" after one that did not go, as
     the board's. After #7108 merges, this branch's pin on the board's keyOf fallback is updated on rebase.
   - Round 5: 0 blockers, 2 warnings, 3 nits. Fixed: focus is not pulled back once VoiceOver left that row's
     Dismiss while the row was still there (needsLeft); at an accessibility size even one member's row sits behind
     Show, so the band can always be made small; only the row that failed reads "Try again"; the failure line wraps;
     the built fallback key tested through needsNotice (Character cuts and a wrong cap now red). Room 265/265;
     Debug SUCCEEDED.
   - Round 6: 0 blockers, 0 warnings, 1 nit, fixed: the focus target after a dismiss uses the view's own fold rule.
     The pin on the board's fallback key accepts its line before and after #7108. Converged.
3. Validation, PR.
