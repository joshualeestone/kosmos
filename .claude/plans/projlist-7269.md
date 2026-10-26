# projlist-7269: iPhone Projects list and Tasks tiles (kosmos#7269, Josh 2026-10-26 18:26)

## Finished looks like
The iPhone Projects list shows each project's members as small overlapping faces (the first nine, then "+N" past ten),
no "N agents" text and no model marks, and sub-projects hang off a light dashed connector line; the Tasks tab opens
with a row of four count tiles (Open, Needs you, Working, Done). Shots light and dark, large and small iPhone, for
projects of 3, 12 and 15 members with nesting, and the tiles.

## Built
- BoardRoom.swift: faceBubbles(count, room:) (up to 10 faces, else 9 and +N); projectTree rows carry lastKid,
  hasKids and `through` (ancestor lines that run past the row). The provider tally (providerTally, TallyEntry,
  flowLayout/flowLines, providerTallySpoken) is removed with its tests; the provider table and marks stay, kept equal
  to the board's, for the agent page's AI Settings (#7267).
- ProjectsView.swift: faces with a card-coloured ring, "+N" capsule, fewer faces when the row is narrow (ViewThatFits
  10/6/4/2); a dashed connector (rail under the parent's first face, elbow to the name, last child stops at its elbow,
  ancestor lines carried through); rows draw their own vertical inset so the line meets the next row; no separator
  inside a family. VoiceOver still hears "N agents". Debug-only KOSMOS_SAMPLE_CROWD=1 for the shots.
- TasksLogic.swift: Tasks.tiles (Open = not completed; Needs you = decision, nil when agents unread; Working; Done).
- TasksView.swift: TaskTiles, four in a row (two by two at accessibility sizes), in an inset-free header.

## Decided
- Tiles are display only, not filters (the desktop's filter). Rejected: filtering now (more states to keep right under
  live updates). Would change my mind: Josh tapping one and expecting it to filter.
- Four tiles in Josh's order, not the desktop's eight: a phone row holds four.
- Unlike the desktop, a deeper row carries its ancestors' lines (the desktop's one-level rail broke visibly here).
- Weakest premise: that ten faces fit at default text on the smallest phone (measured on iPhone SE 3rd gen: they do).
