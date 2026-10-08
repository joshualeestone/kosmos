# deadexports-5582: delete superseded engine exports only their own tests call (kosmos#5582, kosmos#5583)

## Deleted
- chat.wireText (+ WIRE_SEMICOLON, its measured tmux doc and its test): deliver() pastes the raw wire (#3419); the
  "retained" note's argument (documents tmux behaviour) is kept by git history; the comments that named it reworded.
- projects.setDescription, projects.setArchived (one-line wrappers over edit()): fixtures and tests call
  projects.edit(id, { description | archived }) instead, so their behaviour stays tested; an orphaned duplicate of
  setArchived's doc (sitting on cleanArchivedAt) removed; one test title renamed.
- fedmembers.labelForMember: its tests read labelsFor(p).get(m) || null.
- inflight.minInterval (+ its test file), #5583 DECIDED delete: wiring it is a remembered answer inside a window,
  which #1618 forbids (4 tests red against the wiring); the page shows no age; the instruction is enough (agents read
  disk-only #4451, cross-site refused #1636, the page reads only on opening Connections). Reasons on the card.

## Validation so far
- 620/620 across the 11 affected test files; browser check render-tasks-view-3559 passed.

## Still to do (after #5577 merges)
- Rebase on main; remove the five excuses #5577 adds to engine.reachable.test.js; run the reachability guard and
  show each export reads as gone; challenge loop; proof; PR.
