# kosmos#7269 review 1 (blind CTO-lens and design)

Reviewed: 527388a3a557bb9f289407e6371c5eecb1fa8c94

Counts: 0 BLOCKER, 2 WARNING, 6 NIT

## Findings

### [WARNING] ios/Kosmos/ProjectsView.swift:659: the connector's x scales with Dynamic Type but the indent does not

`face` is `@ScaledMetric(relativeTo: .footnote)` (24 at default), and every vertical line sits at `(depth-1) * indent + face/2 + 1.5`, while `indent` is a fixed 28 and the elbow ends at `depth * indent - 4`.

Failure scenario: at an accessibility text size `face` grows well past 45pt (footnote scales about 3x or more at AX3 to AX5). Then `face/2 + 1.5 > 24`, so a child's vertical line lands to the right of where its elbow ends: the elbow is drawn backwards (right to left), and the vertical dashed line runs straight through the child's name, description and faces, which start at x = 28. The deeper the row, the worse. Nothing in the screenshots covers this (they are at default size).

Fix: make the indent follow the face, for example `private var indent: CGFloat { max(28, face + 8) }` used for both the padding and the line maths (it is currently `static`, so it has to become an instance value), or clamp the line x to `indent - 8`. Take one design shot at AX3 on the SE to confirm.

### [WARNING] ios/Kosmos/ProjectsView.swift:645: the elbow is placed from the top, but the row centres short content in its 64pt minimum

The elbow is drawn at `y = 10 + nameMid` (about 20.5), which assumes the name line starts 10pt below the cell top. `.frame(minHeight: 64)` uses the default `.center` alignment, so any row whose padded content is under 64pt is centred.

Failure scenario: a sub-project with no members and no description (members can be empty: the sample's archived "Old launch" has `agents: []`). Its padded content is about 21 + 20 = 41pt, centred in 64, so its name sits at about y = 32 while the elbow points at y = 20.5, roughly 11pt above the name. Related: a parent with no members (or with a folder problem) draws no stub, so its children's line starts at the cell top with nothing above it to hang from.

Fix: `.frame(minHeight: 64, alignment: .topLeading)` so the name is always 10pt down (rows with faces are already over 64, so they do not move). For a member-less parent, start the stub under the name instead (`y = 10 + nameMid * 2`) rather than drawing none.

### [NIT] ios/Kosmos/ProjectsView.swift:581: the separator after a family is inset to the last child's text

Measured on large-light-projects.png: the separator under "Store signage" and under "Cover shoot" starts at x of about 135 (the indented child's text), while a top-level row's text starts at about 76. The rule that closes a family reads as belonging to the child, not as the boundary between top-level projects.

Fix: `.alignmentGuide(.listRowSeparatorLeading) { _ in 0 }` on the row, offset to the top-level text leading (or to the depth-0 position) so every family boundary has the same inset.

### [NIT] ios/Kosmos/TasksLogic.swift:154: Open counts tasks the list below it never draws

Open is `state != "closed"`, so a task in a state the board has no group for (the test's `weird`) is counted in the tile but, as the existing test at tasks/main.swift:87 says, is not drawn. The new test at tasks/main.swift:103 pins Open=8 for a list that draws 7 open rows.

Failure scenario: the Mac ships a new task state before the phone learns it; the Open tile says one more than the person can find.

Fix: count Open over `groups` keys other than closed (`rows.filter { $0.state != "closed" && groups.contains(where: { g in g.key == $0.state }) }`), and change the test to expect 7. Or keep it deliberately and say so in the comment; either way, make tile and list agree.

### [NIT] ios/Kosmos/TasksView.swift:431: tile words differ from the group headings, and "Needs you" wraps on the SE

The tiles say Working / Done / Needs you while the list right under them says In progress / Completed / Needs Your Decision. These are Josh's words from the card, so not a defect, but a person reads two names for one group on the same screen. On small-dark-tasks.png "Needs you" breaks onto two lines ("Needs" / "you") while its neighbours are one line.

Fix: ask Josh whether the headings should follow the tile words (or vice versa); for the wrap, `lineLimit(1)` with `minimumScaleFactor(0.8)` at non-accessibility sizes, keeping two lines only at accessibility sizes.

### [NIT] ios/Kosmos/BoardRoom.swift:589: providerTallyOrder, providerMarkAsset and ProjectMember.provider are now unused by the app

After removing the tally, grep of ios/Kosmos finds no app reader of `providerTallyOrder` or `providerMarkAsset`; only LogicTests read them, and `provider` is still parsed for nothing. The comment says they are kept for #7267. Nothing is broken (no dangling references to TallyEntry, TallyFlow, flowLines, flowLayout, providerTallySpoken, markSize, facesAndCount or countText anywhere under ios/).

Fix: fine to keep if #7267 is next; otherwise remove them with their drift tests so tests do not guard dead code.

### [NIT] ios/Kosmos/ProjectsView.swift:747: VoiceOver still hears nothing about nesting

The connector is `accessibilityHidden` and the label is name, word, unread, description, "N agents". A sub-project reads exactly like a top-level project. Pre-existing (indentation alone never spoke either), but the card is about showing nesting.

Fix: pass the parent's name into the row and append "in <parent>" (or "sub-project of <parent>") to `spoken` when depth > 0.

### [NIT] ios/LogicTests/room/main.swift:237: the `through` test covers one level only

`through` is only tested as `[1]`. A row two levels under two open ancestors (expected `[1, 2]`), and a non-last child at depth 2 whose own child should carry `[2]` but not `[1]` when depth-1 is last, are not exercised. The code is right by reading, but a regression in the `open + [depth]` rule at depth 2 would pass.

Fix: add a four-level fixture asserting `[1, 2]` and `[2]`.

## Checked and found clean

- Tree flags, read against the code: `lastKid` is false at depth 0 and true only for the last unseen child; `hasKids` is set after recursion by checking that the next emitted row is one level deeper, which is exactly "children shown right under it"; `through` adds `depth` only when the row is not last and depth > 0, so a top-level project never opens a line. Measured on large-light-projects.png: Retail rollout's line runs past Staff training and Week one to Store signage and stops at its elbow; Week one's own line stops at its elbow.
- Orphans and archived parents: lifted to depth 0 with no flags (read; test at room/main.swift passes). Cycles: both rows emitted by the fallback loop at depth 0 with default flags, no line (read; tested). Pre-existing and unchanged: a child of a project in a cycle is also flattened to depth 0.
- Separators: hiding the next row's top edge removes the rule between adjacent rows (measured on the screenshots: none between a parent and its first child, none between Week one and Store signage, one after each family).
- faceBubbles: 0, negative, exactly room, room + 1, room 0 and room 1 all give non-negative faces and faces + more == count (read and tested). 15 members show 9 faces and +6, 12 show 9 and +3 (measured on screenshots).
- ViewThatFits fallbacks 10/6/4/2: the first face stays at the same x in every fallback, so the parent stub still lines up (read).
- Dark mode: rail pair 0xbdb8ae / 0x4a4e55 is quiet but visible on the dark card; face rings use Palette.card, which matches the row background in both themes (measured on small-dark-projects.png and large-light-projects.png).
- Model indicators and the "N agents" text are gone from the row; VoiceOver still hears the count (read).
- Debug-only sample: `sampleProjects`, `sampleCrowd` and `sampleBase` sit inside the `#if DEBUG` block at ProjectsView.swift:419-435, and both callers (ProjectsView.swift:94-96, NewTaskView.swift:218-220) are inside `#if DEBUG` (read).
- Tasks tiles: scoped with the same `Tasks.scoped` as `sections`, so a picked project counts only its own tasks (read; tested with two projects). "?" when `rosterUnknown`, spoken as "cannot tell", red only with a count above 0, which matches the board's `data-n="unknown"` rule (read against web/index.html:4456-4462 and 68560). Two columns at accessibility sizes (read). Tiles line up with the cards' edges in both screenshots (measured).
- Logic tests run: room PASS 444/444, tasks PASS 95/95. The new tree checks compare full flag strings, so they can fail.
