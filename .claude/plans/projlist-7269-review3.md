# projlist-7269 review 3 (blind CTO-lens and design)

Reviewed: 8d5a19fdd9826a6eddfb42e2f69eaaf1d9b0805d

Counts: 0 BLOCKER, 1 WARNING, 1 NIT

## Findings

### [WARNING] ios/Kosmos/TasksView.swift:203: the "N Tasks on M Projects" line under the tiles counts the newest read, the Open tile counts the drawn list, so the two disagree right next to each other after a live update

`Tasks.tiles(shown, ...)` (TasksLogic.swift:151) counts from `shown`. Review 2 moved it there on purpose, so a task that changes group while the list keeps its place does not make a tile and its group disagree. But the title line drawn directly under the tiles is still `Tasks.title(read, project:)` (TasksLogic.swift:268), and that counts `scoped(read.tasks).filter { state != "closed" }` from the NEWEST read.

Failure scenario: the list shows 7 open tasks. An agent closes one, and the live update keeps the row in its group (keepingPlaces). The Open tile still says 7, as it should, but the line under it now says "6 Tasks on 4 Projects". A second case: a row in a state the phone has no group for is in the title's count and left out of the tiles, so the two differ even on a fresh layout. In the shots the two numbers already sit one under the other and say the same thing ("7 / Open" over "7 Tasks on 4 Projects"), so any drift is easy to see.

Fix: compute both from the same source. Either derive the title's count (and the project count) from `shown` excluding "closed", or, since the Open tile now carries the count, drop the number from the line and keep only "on 4 Projects" or the picked project's name. Add a test beside "a task that moved while drawn counts where the list shows it" asserting that the title and the Open tile agree after keepingPlaces.

### [NIT] ios/LogicTests/room/main.swift:700: the section title says the agent page draws the marks (#7267), which is not true on this branch or on main

After the tally was removed, nothing in ios/Kosmos references MarkClaude, MarkOpenAI, MarkGemini, MarkGrok, MarkMeta or MarkQwen. Measured: `grep -rnE '"Mark|Mark[A-Z][a-z]+"' ios/Kosmos` finds only "Marked built" strings, and `git grep` on origin/main finds them only in the tally code this diff removes. Their only user is agentinfo-7267, which is not merged. `ProjectMember.provider` (BoardRoom.swift:552, parsed at :718) is now also read by nothing. This is harmless if #7267 lands soon. But if it does not, the six image sets ship unused in the bundle, and the test's title states as fact something that is only planned.

Fix: say "the agent page will draw them (#7267, in flight)", or leave it as it is and make sure #7267 takes over the test.

## Checked and found clean

- projectTree flags (read and traced by hand): `lastKid` is false at depth 0 and true only for the last of a parent's shown children. `through` adds level d exactly when a depth-d row is not last, and level L maps to x = (L-1)*indent, which is the same x as a depth-L row's own line and a depth-(L-1) parent's `hasKids` stub (both `(depth-1)*indent + face/2 + 1.5`). So the lines meet. `hasKids` is set after the recursion from the next row's depth. The `where !seen` re-check inside the enumerated loop cannot skip the last child: projects have a single parent, so kids lists are disjoint, and nodes on or under a cycle are unreachable from the root walk. The four-level test (D carries [1, 2]) and the ladder case match the trace.
- faceBubbles: n <= room gives every face; otherwise room-1 faces and the rest, so faces+more always equals n. Room 0 and negative counts are clamped. ViewThatFits over rooms 10/6/4/2, with room 2 as the always-fitting fallback (1 face plus a pill), is consistent with the shots: +6 and +3 at default size, +10 and +7 at AX sizes on both phones.
- Removal of the provider tally: grep of ios/ for providerTally, TallyFlow, flowLines, flowLayout, TallyEntry, providerMarkAsset, markSize, facesAndCount, countText and PJ_TALLY finds nothing left in app code or tests. The test for the marks being the board's own is kept and still passes.
- Separators: the shots show no separator between a parent and its first child or between siblings, and one separator after each family's last row before the next top-level project (Store signage then Spring catalogue, Cover shoot then Website). So hiding the top edge on a depth>0 row does suppress the shared separator. Leading guide 0: separators start at the card's text edge.
- Connector meets the next row: listRowInsets top/bottom 0 with the row drawing its own 10pt, and the dashed rails are continuous across rows in all four Projects shots, including the carried level-1 line past "Week one" down to "Store signage". The elbow sits on the first line of a wrapped name (small a11y, "Staff training").
- ScaledMetric indent and face: at AX sizes on the SE the line sits under the first face and clears the indented names. The names wrap to 3 lines instead of truncating.
- Dark mode: the rail pair and the card-coloured face rings read in large-dark Projects; the tiles and the red Needs you tile read in large-dark Tasks.
- VoiceOver: faces hidden, the row says "in <parent>" and "N agents". Each tile is one element, "Needs you, cannot tell" when the roster is unknown. Connector is accessibilityHidden.
- Tasks tiles vs the list below: Open counts every drawn non-closed row, which matches the group headers (7 = 1+1+1+1+... in the sample). The keepingPlaces test proves a moved row counts where it is drawn. rosterUnknown is taken from the same fresh read that sets the drawn decision group's `unknown`. Two columns at accessibility sizes (small-light-tasks-a11y).
- Debug-only sample: sampleProjects, sampleCrowd and sampleBase are all inside `#if DEBUG` (ProjectsView.swift:419 to 435), and the only reader (line 95) is inside its own `#if DEBUG`.
- Tests can fail: they assert exact flag strings, through arrays, tile strings and faceBubbles tuples. Ran run-room.sh: PASS 425/425. Ran run-tasks.sh: PASS 96/96.
- Branch is 79 commits behind origin/main. `git merge-tree --write-tree HEAD origin/main` is clean, and main's ios changes since the merge base touch only ContentView, SettingsView, ShellLogic and LogicTests/main.swift, none of the files in this diff.
