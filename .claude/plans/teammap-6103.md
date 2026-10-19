# teammap-6103: a project's team map, read-only (kosmos#6103)

Decided on the card (comment 6219875844, 2026-10-16), on Splinter's steer; Josh can override.

## What it is
- A quiet "Team map" button in the Members card (tab layout). Closed by default; opens a panel in place.
- The panel (`pjTeamMap(p, board, redHere)`, pure): the project's members nested by who they report to, using the org
  chart's own `orgTreeOf` so the shapes cannot disagree. Each member is a button (opens its page via
  `openDetail`, as a member row does) showing model family (`WV_PROVIDER`; Qwen from the board card's account),
  its status word (`stateCopyOf`; "Kosmos cannot see it" for an absent member), and how many open task parts it
  holds.
- "Who handed work to whom": counted ONLY from a part's `movedBy` (#6150). No `movedBy`, no hand-off line.
- Needs-you is not repeated: the existing needs-you block above the members says it. Every member that block lists
  gets "!": both of its sets, needsYouHere and a present member `pjRedHere` draws red (passed in, as to
  pjNeedsNotice), so the two surfaces cannot disagree (review round 2).
- A repaint of the open map puts focus back on the member that had it, found by data-agent (review round 2).

## Counting rules
- A part is held when its task is open (`!closedAt`, `!progress.closed`), the part is open (`!closedAt`), and
  `who` is a member of this project.
- A hand-off counts when, on such a part, `movedBy` is a member and is not the holder.

## Not in this slice
- The consolidated layout (the Members card is hidden there): #6324 (April, stacked on this branch).
- A drawn picture with arrows, and "talks most" per pair (needs a message-log route).

## Weakest premise
That people want the map per project, not per company.

## Checks
- `web.teammap-6103.test.js`: real projects and tasks engines; covers a closed part AND a closed task with open
  parts, and red members the block lists without a needsYouHere. Mutants proven red: seven in round 1, then the
  red-member clause, the task-level skip, and the call site passing pjRedHere.
- `docs/browser-checks/render-teammap-6103.js`: opens, closes, every member, opens an agent, fits 375 wide, and
  a forced rebuild (setLive memory cleared, a new node) keeps the focused member focused. Mutants proven red:
  no button, dead map click, no focus restore.
- The same browser check proves movedBy reaches the page through the real route (review round 3): a part
  written to the board's projects.json as moved by tmada shows "tmada handed tmben 1 open part" after a
  reload, after a CONTROL showing a screen-given task is no hand-off. Mutant: partsOf without its movedBy
  carry reds it.

## Review round 4
- Fixed: the unit test's "holds" assertions matched greedily across nodes, so a later member's words met an earlier
  member's claim and the progress.closed skip had no guard (the reviewer's mutant stayed green). They now read one
  member's own button (`held()`); the progress.closed arm also asserts no hand-off. Mutant now red.
- Fixed: the needs-you set is computed once per map (pjRedHere builds a member's row); the button uses the map's own
  roster filter; the absent / restarting status words are tested.
- Deferred: the movedBy arm edits projects.json while the board runs. projects.readAll reads the file on every call
  (engine/projects.js) and mutate is read-modify-write with no cache, measured in the arm's own diagnostics (disk
  holds movedBy before and after the route read); the edit and the reload are milliseconds apart. If it ever races,
  the failure prints the disk reading after write and after the route, so the race names itself.
