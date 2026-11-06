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
engine/remove.test.js 115/115, server.agent-remove-name-8109.test.js 10/10, server.guide-hidden-3739 7/7, server.setup-guide-page-3034 15/15, cli.agent-remove-7362.test.js 26/26,
server.agent-remove-4475.test.js 36/36, server.test.js 368/368, run from the worktree. Mutants: guide filter
removed (route test red); folder scan used despite cards (three engine tests red).

## Review round 1 (opus; no BLOCKER)
- WARNING: nothing tested that removed agents stay out on the cards path --> FIXED: route test with a real,
  recorded removal (a stubbed runner, since DRY_RUN reports "removed" and records nothing); mutant (both removed
  filters dropped) red.
- WARNING: the folder scan had no production caller and kept the over-wide candidate set behind an exported
  `resolveName` --> FIXED: folder scan and `resolveName` deleted; `resolve` resolves nothing without cards. The
  engine tests now pass the cards (`listedOf`); the two folder-scan-only tests (removed agent, unreadable candidate)
  are replaced by the route tests.
- CONVENTION: the guide rule was copied --> FIXED: `guideMarkName()`, one rule for the list route and resolution.
- NIT: the 'unchecked' guide fallback is untested --> NOT REACHABLE from resolution: `register.survey()` fails closed
  on an unreadable removed list first, so the cards are `null`. Added instead: an unreadable removed list resolves
  nothing, with a live card in it (the first version had none, and a mutant ignoring the survey's failure survived;
  with the live card it goes red).
- NIT: two false docstring sentences --> FIXED.

## Review round 2 (sonnet; no BLOCKER)
- WARNING: the list route drops a stopped row whose build throws; `cardsForResolve` keeps it --> DEFERRED, documented
  at `cardsForResolve`. Usually it only adds an ambiguity refusal; when the dropped row is the only match it resolves
  to that real agent and the plan's question names it. Fixing needs one shared roster function (the list route's
  inline builder), larger than this card. Would change my mind: a row that throws for a common reason.
- NIT: the guide test left its marker file behind --> FIXED.
- NIT: dry-run restored as a hardcoded true --> NO CHANGE (the suite sets it; nothing reads the old value).
- NIT: guideMarkName read after the awaited reads, a one-poll skew --> NO CHANGE (fails safe).
