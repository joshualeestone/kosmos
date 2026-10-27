# projlist-7269 review 2 (blind CTO lens and design)

Reviewed: cd3ec7285fb84d0b1a3dc0a82a30b513f15f349b

Counts: 0 BLOCKER, 3 WARNING, 4 NIT

## Findings

### [WARNING] ios/Kosmos/TasksView.swift:195: the tiles count the fresh read, the list under them keeps its old places
Failure: `list(read)` builds the tiles from `read`, but the groups drawn under them come from `shown`, which `keepingPlaces` deliberately freezes during a live update (a task that moved stays in the group it was drawn in until the next lay-out). A task moving from working to closed while the tab is open shows tile "Working 0 / Done 3" above an "In progress 1" header still holding that task and "Completed (2)". The comment at TasksLogic.swift:154 ("the tile and the list below it never disagree") is false in exactly the moment a person is watching.
Fix: derive the four counts from `shown` (sum of non-closed section rows for Open, the decision section's rows or "?" when `unknown`, the working and closed sections' row counts), or recompute tiles only in `layOut()` alongside `shown`. Add a LogicTests case: tiles from `keepingPlaces(...)` output after a state change equal the section counts.

### [WARNING] ios/Kosmos/TasksLogic.swift:155: the Open tile and the "N Tasks" title right under it count differently
Failure: Open filters to states with a group; `Tasks.title` (TasksLogic.swift:271) counts every `state != "closed"`. With the test's own `mixed` fixture (one task in an unknown state "weird") the tile reads "Open 7" and the line directly beneath it reads "8 Tasks on ...". Any new server state shipped before the phone learns it produces this mismatch, one line apart.
Fix: one definition for both. Either have `title` use the same grouped-states filter (the list does not draw the unknown task, so 7 is the honest number), or extract a shared `openRows(_:project:)` used by both. Add a check that `tiles(mixed).open` matches the number in `title(mixed)`.

### [WARNING] ios/Kosmos/ProjectsView.swift:667: the indent now scales with text, so nested names truncate hard at accessibility sizes
Failure: the indent was a fixed 16pt; it is now a ScaledMetric of 28pt, so at accessibility sizes each level costs roughly 50 to 60pt, while the name is still `lineLimit(1)` beside a status word. In small-light-projects-a11y.png (iPhone SE) the depth-1 row already reads "Staff tr..." next to "Working", and its description "Guides and the first..."; a depth-2 or depth-3 row with a status word would show only a letter or two. The scaling fixed the line crossing the name (review 1) by spending the name's width.
Fix: at `dynamicTypeSize.isAccessibilitySize`, let the name wrap (`lineLimit(2)` or `nil`) and/or put the status word on its own line under the name; alternatively cap the per-level indent (for example `min(indent, 40)`) and keep the face size scaled. Re-shoot SE a11y with a depth-2 row that has a status word.

### [NIT] ios/Kosmos/AgentsView.swift:386: the faces scale with text but the letter inside them does not
Failure: `AgentAvatar` draws its initial at a fixed 17pt, while `face` is now a ScaledMetric (24pt at default). At accessibility sizes the circle grows and the letter stays small (visible in large-light-projects-a11y.png: a small "C" in a large disc); at xSmall/Small text the face shrinks to about 20 to 22pt and a 17pt semibold "W" or "M" is clipped by `clipShape(Circle())`.
Fix: in AgentAvatar, size the letter from `size` (for example `size * 0.55`), which keeps every other caller's 22 to 44pt avatars looking as they do now.

### [NIT] ios/Kosmos/BoardRoom.swift:552: the provider data and marks are now unread by the app
Failure: after the tally's removal nothing in ios/Kosmos reads `ProjectMember.provider` (still parsed at BoardRoom.swift:718), and no app Swift code references the six `Mark*` imagesets (only LogicTests/room checks them against the board). They ship unused until agentinfo-7267 lands; that branch's comment also cites `Board.providerMarkAsset`, which this change deletes, so it goes stale on merge.
Fix: none needed if #7267 is next; otherwise drop `provider` from ProjectMember and tell the #7267 author to reword the comment. Not a correctness problem.

### [NIT] ios/Kosmos/ProjectsView.swift:677: a parent with a folder problem draws no start of its children's line
Failure: the stub below the parent is suppressed when `folderProblem != nil`, but its children still draw their rail from the top of their own rows, so the line starts in mid-air with a 10pt gap under the parent (the parent's faces, if any, still sit at the same x). Small, but it reads as a broken line on exactly the rows that already look wrong.
Fix: draw the stub regardless (it is 8pt below all content, so it cannot cross the red problem text), or document why it is skipped.

### [NIT] ios/Kosmos/TasksView.swift:418: at accessibility sizes the tiles take most of a small screen
Failure: two rows of two tiles at title2 plus the title line fill roughly half of an iPhone SE (small-light-tasks-a11y.png): the first task's title is under the tab bar on first view. Not wrong, and the grid is the right fallback, but the tiles are display-only and push the actionable Needs Your Decision row off screen.
Fix: optional; at accessibility sizes consider a single compact row of number-only tiles, or `.caption` labels with `title3` numbers. Josh's call on "nice and clean".

## Checked and found clean

- projectTree flags (read, then reasoned per case): each project lives in exactly one `kids` list, so the `seen` filter on `under` never shrinks it mid-loop and `lastKid` (i == under.count - 1) is the true last sibling. `hasKids` reads the next emitted row, which is the first child because children are emitted immediately after the parent. `through` passes `open + [depth]` only for a non-last child at depth > 0, and every consumer draws level L at `(L-1)*indent + face/2 + 1.5`, which is the same x as the parent rail drawn by a depth-L row and the parent stub of a depth L-1 row: the three lines meet. Orphans and children of archived parents are re-keyed to "" and get depth 0, `lastKid` false; their former parent is archived or absent so starts no stub. Cycles and nodes hanging off a cycle are never reached from "" and fall to the trailing loop at depth 0 with default flags (no line). Covered by the new checks (ladder, four-level, orphan, cycle), all of which would fail under a mutation of `through` or `lastKid`.
- faceBubbles: n <= room shows every face; otherwise room-1 faces and the rest as +N, total always n; negative counts clamp to 0; room 0 clamps to 1 (0 faces, +n). Tested at 0, 3, 10, 11, 12, 15, room 4 and 2, negatives.
- ViewThatFits fallbacks 10/6/4/2 in the screenshots: 9 faces +6 and +3 at default size, 5 faces +10 and +7 at accessibility size on both phones; nothing runs past the row edge.
- Separators: depth > 0 hides the top edge and non-last children hide the bottom, so a family has no separator inside it and one after it (screenshots: one rule after Store signage, one after Cover shoot). The listRowSeparatorLeading guide of 0 starts it at the card's text edge.
- Connector meeting the next row: rows set top/bottom listRowInsets to 0 and draw their own 10pt padding, so each background reaches the cell edge; the dashed rail is continuous across Retail rollout > Staff training > Week one > Store signage in light, dark and a11y shots, and the elbow sits at the name's middle at both sizes (nameMid scales with callout).
- Dark mode: rail colour is a light/dark pair; visible but quiet in small-dark-projects.png; face rings use Palette.card so the overlap reads in both themes.
- VoiceOver: faces and connector are accessibilityHidden; the row label still says the member count ("3 agents") and now "in <parent>" for a sub-project; each tile is one element "Open, 7" / "Needs you, cannot tell".
- Removal sweep: `git grep` on HEAD for providerTally, TallyFlow, flowLines, flowLayout, providerMarkAsset, TallyEntry, markSize, PJ_TALLY finds nothing under ios/; LogicTests still compile (run below). The asset catalog keeps the six marks, still checked against the board's marks in LogicTests/room.
- Debug-only samples: `sampleProjects`, `sampleCrowd`, `sampleBase` and KOSMOS_SAMPLE_CROWD sit inside `#if DEBUG` (ProjectsView.swift:419-435) and their only use (line 95) is inside `#if DEBUG` too; Release never sees them.
- Tiles vs list at rest: Needs you uses the decision state and is nil when rosterUnknown (same "?" as the group header), Working and Done match the In progress and Completed counts; red only with a count above 0, as the board's tile.
- Tests measured: run-room.sh `VERDICT: PASS 425/425`, run-tasks.sh `VERDICT: PASS 95/95` at the reviewed sha.
- Branch is 6 commits behind origin/main; those commits touch ContentView, SettingsView, ShellLogic and LogicTests/main.swift only, none of this diff's files.
