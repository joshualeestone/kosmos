# teammap-6103: a project's team map, read-only (kosmos#6103)

Decided on the card (comment 6219875844, 2026-10-16), on Splinter's steer; Josh can override.

## What it is
- A quiet "Team map" button in the Members card (tab layout). Closed by default; opens a panel in place.
- The panel (`pjTeamMap(p, board)`, pure): the project's members nested by who they report to, using the org
  chart's own `orgTreeOf` so the shapes cannot disagree. Each member is a button (opens its page via
  `openDetail`, as a member row does) showing model family (`WV_PROVIDER`; Qwen from the board card's account),
  its status word (`stateCopyOf`; "Kosmos cannot see it" for an absent member), and how many open task parts it
  holds.
- "Who handed work to whom": counted ONLY from a part's `movedBy` (#6150). No `movedBy`, no hand-off line.
- Needs-you is not repeated: the existing needs-you block above the members says it; a member it counts gets "!".

## Counting rules
- A part is held when its task is open (`!closedAt`, `!progress.closed`), the part is open (`!closedAt`), and
  `who` is a member of this project.
- A hand-off counts when, on such a part, `movedBy` is a member and is not the holder.

## Not in this slice
- The consolidated layout (the Members card is hidden there): a follow-up.
- A drawn picture with arrows, and "talks most" per pair (needs a message-log route).

## Weakest premise
That people want the map per project, not per company.

## Checks
- `web.teammap-6103.test.js`: real projects and tasks engines; seven mutants proven red.
- `docs/browser-checks/render-teammap-6103.js`: opens, closes, every member, opens an agent, fits 375 wide;
  two mutants proven red.
