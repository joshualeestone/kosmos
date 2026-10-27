# projlist-7269 review 5 (blind CTO-lens and design)

Reviewed: b088ffc3052063dfe3f16eda5a804f91652b2fe8

Counts: 0 BLOCKER, 0 WARNING, 2 NIT

## Findings

### [NIT] ios/Kosmos/TasksLogic.swift:458: the title and tiles now leave out an unknown-state task, but the picker still counts it
Failure scenario: the read carries a task whose state is not one of TSK_GROUPS (a newer engine's state). `Tasks.sections` and `keepingPlaces` do not draw it, so the Open tile and `title(_:drawn:project:)` leave it out ("2 Tasks on Ads"). `pickerProjects` still counts every non-closed row, so the picker beside it reads "Ads (3)". Before this branch, the title and the picker both counted from the read, so they agreed. The test at tasks/main.swift ("an unknown state: the line and the Open tile agree") pins the tile and title against each other but not against the picker.
Fix: count the picker's `open` only over rows whose state is a drawn group (`Tasks.groups.contains { $0.key == t.state && $0.key != "closed" }`), or accept the gap and say so in the comment above `pickerProjects`. This only matters for an unknown state, so it is low priority.

### [NIT] ios/Kosmos/ProjectsView.swift:240: a parent's line starts 8pt above its row's bottom, so on a short parent it floats away from the parent's content
Failure scenario: a parent project with no description and no members (or one whose content is shorter than the 64pt minimum) is top-aligned, so its content ends about 30pt down. The `hasKids` segment still starts at `height - 8`, which leaves a gap of about 25pt between the name and the start of the line, and there is no first face for it to hang under. All the sample parents have faces and a description, so the shots do not show this.
Fix: optional. Start the segment from the bottom of the content (measure it with an anchor preference), or accept it, since a parent with sub-projects and no members is rare.

## Checked and found clean

- **Tree flags (read and measured).** I traced `projectTree` emit by hand:
  - `lastKid` is only ever true at depth > 0.
  - `through` adds `depth` only for a non-last child at depth > 0. Level L is drawn at x=(L-1)*indent, which is the same x that siblings at depth L use for their own line, so a carried line meets its sibling's.
  - `hasKids` is set after the recursion from the next emitted row's depth.
  - Each project is in exactly one `kids` list, so the inner `where !seen` can never skip an index of `under`, and `i == under.count - 1` is the true last child.
  - The cycle and orphan fallbacks emit depth 0 with no flags.
  - The tests cover a three-level chain and a four-level ladder (`D:[1, 2]`) and can fail: the expected arrays are exact.
- **Connector drawing (screenshots).** All four Projects shots show the following:
  - The elbow sits at the name's middle.
  - Week one's line hangs under Staff training's first face.
  - The level-1 line carries through Week one to Store signage.
  - The last child's line stops at its elbow.
  - In a11y on the SE, the line clears the wrapped "Staff training" name.
  - The dark rail is light and dashed but still visible.
- **Separators (screenshots).** There is no separator inside the Retail family. That includes the edge between Week one (a last kid with bottom `.automatic`) and Store signage (top `.hidden`), so hiding either side of a shared edge is enough. A full-width separator closes each family, and its leading guide is 0.
- **faceBubbles (read and tested).**
  - 12 members give 9 faces and +3, which is Josh's example.
  - `room` 0 and negative counts never lose a member.
  - In ViewThatFits, rooms 10, 6, 4 and 2 step down. The SE a11y shot shows 5 faces and +10, then 5 faces and +7, with nothing past the edge.
  - The faces are hidden from VoiceOver, and `spoken` still says "N agents" and "in <parent>".
- **Tiles, title and project line (read and measured).** All three read the same `shown` sections, which `layOut` or `keepingPlaces` produce. That covers each case below:
  - **Live move:** the tile, the title and the group agree. The test has a control showing that the read alone says 0.
  - **Reopened-while-drawn:** the title does not name the project, so `leaveOutProjectLine(drawn:)` keeps the line. The test has a control.
  - **Picked project:** the counts are scoped through `sections` and `keepingPlaces`. A project that leaves the read resets to All projects.
  - **Empty list with the agents unreadable:** the list is drawn with the "cannot tell" group, and the tiles read 0 / ? / 0 / 0.
  - **Agents unread with decision rows present:** the tile reads "?", which matches the board's tsk-tiles (web/index.html line 68558: "?" regardless of n).
  - **Before the first layout:** `onAppear` lays out, and `update` lays out when `shown` is empty.
- **Tile design (screenshots).** The tiles line up with the cards' edges. In a11y they become two rows of two, and Needs you is red only when its count is above zero, as on the board.
- **Dead code.** The provider tally, `TallyFlow`, `flowLines`/`flowLayout` and `providerMarkAsset` have no references left (grep). The Mark* image sets are still checked against the board's marks in room/main.swift, and `provider` is still parsed, both kept on purpose for #7267, as the comments say.
- **Debug-only.** `sampleProjects`, `sampleCrowd` and `sampleBase` sit inside `#if DEBUG`. Both callers (ProjectsView.swift:95 and NewTaskView.swift:220) are inside DEBUG branches too.
- **Tests.** `run-room.sh` passed 425/425 and `run-tasks.sh` passed 102/102 (both measured). The new checks compare exact arrays and strings, and two have explicit controls, so they can fail.
