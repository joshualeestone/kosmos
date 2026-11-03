# passingphone-7850: the phone lets a lasting listing refusal replace a stale Files list

Card: kosmos#7850, items 2 and 3 (item 1, the board's `passing: true`, merged as #7855). Owner: Ice Cream Kitty.

## The problem the card left open
After #7842 the iPhone keeps a shown Files list through EVERY refusal, so a real change (Files becomes a link, a
subfolder is removed) leaves a stale list on screen. #7855 marked passing refusals, but a LASTING one carries no field,
which is exactly what an older board's refusals look like. The phone could not tell "lasting" from "older board".

## The change
- server.js `listingAnswer`: on the three listing routes (agent Files list, agent browse, project documents) a refusal
  not marked passing is sent with `passing: false`. The "Files is a link" refusal says so too (list and browse). The
  engine marks the passing codes (folderState, listFiles, resolveListedDir, listDir, so the folder walk for a download
  carries it too); the routes mark everything else lasting. A list is unchanged.
- ios/Kosmos/FilesLogic.swift `filesLastingRefusal`: true only for an explicit `passing: false` on an ok:false body.
  `filesScreenKeepsShown` returns false for it (the list is replaced), and `filesSection` makes it a `.message` (which
  replaces rows) instead of `.forNow` (which keeps them). No field (an older board): today's behaviour, kept.

## Decided
- Item 3 (a quiet "could not be refreshed" line under kept rows) is NOT in this branch: it is new interface needing its
  own design review, and the card marks it optional. Recorded on the card.
- Rejected: telling an old board by its version (refusals carry none), and a status code for lasting refusals (would
  move the browse route's 409/404 split the phone reads).
- Review round 1 found the premise above was NOT true of the engine: folderState (realpath, stat, access) and
  resolveListedDir (a subfolder's lstat and realpath) caught every error without its code, so a brief EBUSY there came
  unmarked and would now read as lasting (one poll's flicker, the thing #7842 avoids). Both now mark a code in
  PASSING_READ_CODES passing: folderState carries it (listFiles and resolveListedDir pass it on), and resolveListedDir's
  two catches go through unreadFolder (ENOENT/ENOTDIR stay "not there"; any other code now says "we could not read what
  is in that folder" rather than "not there"). Those two catches now also rethrow TypeError/ReferenceError, as their
  siblings do, where they used to turn any throw into "not there"; that reaches the zip and download walks too.
- Review round 2: folderState's `passing` is stripped from the project status answer (it is for the listing routes);
  PASSING_READ_CODES is declared before its first reader. Stated, for the PR: resolveListedDir's other callers (the
  folder download and zip) now say "we could not read what is in that folder" for a non-ENOENT error where they said
  "not there"; no test or page matches the old sentence for those cases.
- Review rounds 3 and 4: the agent Files list, and its browse at the top, answer the empty state ("missing") when the
  listing refuses because the folder went between the route's own check and the read (it was a lasting refusal for
  one poll). Accepted: ETIMEDOUT and
  ESTALE (a network mount) are not passing codes, so on a network-backed folder a timeout replaces a shown list on the
  phone, as any refusal did before #7842. EPERM is lasting too, though on Windows a delete-pending folder or an
  antivirus lock can report it briefly; it is also a real refusal, so it stays out of the passing set.
- Weakest premise now: that the listing routes have no OTHER unmarked brief refusal (the route-level ones are the link
  and the no-agent/no-project 404s, both lasting). Accepted, not changed: `passing` read with `as? Bool` also accepts a
  JSON number; the board only sends booleans.

## Verified
- server.files-passing-7850.test.js: every lasting control now asserts `passing === false` (7), a Files-is-a-link case
  for list and browse, and three for round 1 (folderState EBUSY on the list and the documents, EACCES lasting, a
  subfolder lstat EAGAIN passing and ENOENT lasting), and the folder-gone-between-reads cases (list and browse top).
  20/20 at convergence (review round 5). Mutations Q (passingOf never marks) and R (the old
  resolveListedDir catch) each turn exactly their own test red. Mutation: listingAnswer passing refusals through unchanged turns 7 red.
- ios/LogicTests/files (run-files.sh): 119/119 with the new cases (lasting replaces on the screen and the agent page,
  passing keeps, unmarked keeps). Mutation: filesLastingRefusal always false turns exactly the 7 lasting cases red.
- 15 test files touching the listing routes plus engine.reachable: 845 pass, 0 fail.
