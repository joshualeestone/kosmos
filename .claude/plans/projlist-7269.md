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

## Review
- Round 1 (projlist-7269-review1.md): 0 blockers, 2 warnings, 6 nits. Fixed: the indent scales with the faces (the
  line no longer runs through a name at accessibility sizes; shot at accessibility-large on both phones); rows are
  top-aligned so the elbow meets the name, and a parent with no members still starts its line; every separator starts
  at the card's text edge; Open counts only states the list draws; VoiceOver says "in <parent>"; a four-level ladder
  test; the provider table and mark map (no reader left) removed, the marks' SVG-equals-board check kept (#7267 draws
  them). KEPT: the tiles' words are Josh's (Open, Needs you, Working, Done), not the group headings'.
- Round 2 (projlist-7269-review2.md): 0 blockers, 3 warnings, 4 nits. Fixed: the tiles count the groups the list is
  drawing (a live update can no longer make a tile and its group disagree; tested through keepingPlaces); a project
  name may wrap (3 lines) at accessibility sizes; a parent with a folder problem still starts its line. KEPT: Open
  can be one fewer than the "N Tasks" title when a newer Mac sends a state this build has no group for (the title is
  the board's words, the tiles follow the list); the avatar letter's fixed size is AgentAvatar's (AgentsView.swift,
  shared, unchanged here); at accessibility sizes on an SE the tiles take two rows (a design call: reachable by scroll).
