# projlist-7269 review 4 (blind CTO-lens and design)

Reviewed: 72055cac07320e9642e1881110588173d1009740

Counts: 0 BLOCKER, 1 WARNING, 1 NIT

## Findings

### [WARNING] ios/Kosmos/TasksLogic.swift:294: leaveOutProjectLine still reads the newest read while the title now reads the drawn rows, so a live update can leave the project named nowhere

Review 3 moved the title onto the drawn sections, but `TasksView.list` (TasksView.swift:187) still decides whether rows drop their project line from `Tasks.leaveOutProjectLine(read, project:)`, which counts open tasks from the fresh read. The two rules were designed as a pair (the rows leave the line out *because the title names the project*), and they now read different sources.

Failure scenario: All projects, every task in one project P, all of them Completed. A task in P is reopened while the list is on screen. `keepingPlaces` keeps it drawn in the Completed group, so the title's `open` (drawn rows outside "closed") is empty and it reads "0 Tasks" with no project. `leaveOutProjectLine` sees a non-closed row in the read and returns true, so the rows hide "P" as well. P is named nowhere until the next layout. The reverse move (an open task finishing) gives the milder case: the title says "1 Task on P" and the rows also say P.

Fix: give `leaveOutProjectLine` a `drawn:` overload that mirrors the title's (`shareOneProject(drawn rows) && (project != nil || drawn non-closed group rows non-empty)`) and call it with `shown`, plus one test using the `keepingPlaces` closed-to-open case with a control on the read-based form.

### [NIT] ios/Kosmos/BoardRoom.swift:552: ProjectMember.provider is parsed (BoardRoom.swift:718) and never read

With the tally gone, nothing in the app reads `provider`. The mark assets are explicitly kept for #7267 (the test section says so), but the field has no such note. Either add the same one-line "kept for #7267" comment or drop the field and its parse until the agent page needs it.

## Checked and found clean

- Tests run (measured): run-room.sh VERDICT PASS 425/425; run-tasks.sh VERDICT PASS 99/99.
- projectTree flags (read): `lastKid` only at depth > 0 for the final unseen sibling; `hasKids` set after the recursive emit by checking the next row's depth, correct for a leaf and for a parent whose children are all filtered; `through` appends the current depth only when this row is not last and depth > 0, so a level is carried exactly while an ancestor at that level has a later sibling. Traced against the four-level test (D carries [1, 2]) and the sample screenshot (Week one carries Retail's line on to Store signage). The `where !seen` filter inside the loop is unreachable after the `under` prefilter (each project sits in exactly one kids list; cycle members are never under ""), so it cannot desync `last`. Lifted orphans and cycle rows get no flags (tested).
- faceBubbles (read and tested): totals always add up, room <= 0 clamps to 1, negative counts clamp to 0; 12 gives 9 + "+3" as the card asked.
- Connector geometry (read and screenshots): every x uses the same `level * indent + face/2 + 1.5` formula as the face centre at that indent; indent and face both scale relativeTo .footnote so they stay proportional at a11y sizes (small-light-projects-a11y shows the elbow clear of the wrapped "Staff training"). Background is applied after the leading padding, so it spans the indent. Rows use zero vertical list insets with their own 10pt padding, so lines meet cell to cell.
- Separators (screenshots): none inside a family, one under each family's last row; the shared top/bottom separator semantics behave as the code assumes. Separator leading guide 0 puts every rule at the text edge.
- ViewThatFits (read and screenshots): falls 10 to 6 to 4 to 2 faces; at a11y on the SE the 15-member row shows 5 faces + "+10" without overflow.
- VoiceOver (read): faces and connector are hidden; the row label keeps "N agents" and adds "in <parent>"; tiles are single elements with "Needs you, cannot tell" when the roster is unknown.
- Tiles vs list (read and tested): tiles count `shown`, the same sections the list draws, including after `keepingPlaces` (tested with a moved row and a read-based control) and with a picked project. Needs you uses `read.rosterUnknown`, the same value the drawn decision section's `unknown` comes from. Open and the title's count agree on unknown-state tasks (tested).
- Removed tally (searched): no remaining reference to providerTally, TallyFlow, flowLines, flowLayout or providerMarkAsset in ios/Kosmos.
- Debug sample (read): sampleCrowd, sampleBase and the KOSMOS_SAMPLE_CROWD switch sit between `#if DEBUG` (ProjectsView.swift:419) and `#endif` (:435); nothing outside references them.
- Tests can fail (read): tree tests assert exact flag strings and through arrays; tiles test has a read-based control that would pass if the title still read the read.
- Screenshots: light/dark large and small, a11y; tiles 4 across, 2x2 at accessibility sizes, red border only on a non-zero Needs you.
