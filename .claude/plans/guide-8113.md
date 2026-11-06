# guide-8113: name resolution takes only the names agent list prints (kosmos#8113)

Stacked on agentname-8109 (#8109). Opens as a PR after #8109 merges, rebased onto main.

## Problem
#8109's `remove.resolve` scanned every folder in the workers folder and then added the board's cards. So its
candidates were a superset of what `kosmos agent list` prints. The setup guide, which the list hides, could make a
listed name ambiguous, and typing the guide's display name resolved to it (#8109 review round 8).

## Change
- `engine/remove.js` `resolve`: when the route passes the board's cards, they are the ONLY candidates; the folder
  scan runs only for callers that pass none (the engine's own tests). `null` still resolves nothing.
- `server.js` `cardsForResolve`: leaves out the setup guide by the same rule the list route uses to mark it
  (`setupGuideNow`, and the 'unchecked' fallback to the seeded name when its folder still carries the marker).
- Test helper `folderAgent` in the route test now writes a profile too, as `create` does: the list (and so
  resolution) knows an agent by its profile, not by a bare folder.

## Decided
- Cards only, rather than filtering the guide out of the folder scan: the names that can match are now exactly the
  names the list printed (live cards' `name`, stopped cards' `shownAs`), which also retires #8109's weakest premise
  (that `readIdentity` equals what the list prints).
- Typing the guide's exact folder name still plans its removal, as before #8109.

## Weakest premise
`cardsForResolve` repeats the list route's two sources and its guide rule rather than calling one shared function, so
a later filter added to only one would drift. Extracting the list route's roster is a bigger change than this card.

## Validation
engine/remove.test.js 117/117, server.agent-remove-name-8109.test.js 8/8, cli.agent-remove-7362.test.js 26/26,
server.agent-remove-4475.test.js 36/36, server.test.js 368/368, run from the worktree. Mutants: guide filter
removed (route test red); folder scan used despite cards (three engine tests red).
