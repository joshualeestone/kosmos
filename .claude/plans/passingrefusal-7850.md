# passingrefusal-7850: the board marks a passing listing refusal

Card: kosmos#7850 (follow-up to #7842). Owner: Ice Cream Kitty.

## Scope of THIS branch: item 1 only (the board)
- engine/projects.js: listFiles and listDir add `passing: true` to their two passing refusals,
  "we could not read what is in that folder" and "that folder changed while it was being read".
  Every other refusal (not a folder, not there, a link, no folder recorded, not allowed to read) is lasting and
  carries no mark.
- server.js: unchanged. The agent Files list (200), agent browse (409 at the top, 404 below) and project documents
  (200) already send the engine's answer as it is, so the mark reaches all three.
- server.files-passing-7850.test.js: one passing arm per route plus a lasting control per route, and a no-failure
  control.

## Not in this branch, and why
- Item 2 (the phone, ios/Kosmos/FilesLogic.swift filesKeepsShown): PigeonPete's filesparity-7842 is open and rewrites
  that same function (iteration 6 of its loop). Building on main now would collide. It goes on top once #7842 merges.
- Item 3 (a quiet "could not be refreshed" line): with item 2.

## Decided
- A field, not a 503: a status change would move the browse route's 409/404 split the phone already reads, and an
  older phone reading a 503 would treat it as a server fault. A field is ignored by every client that does not know it.
- "we cannot read this folder" from folderState (realpath/stat failing with something other than ENOENT) stays
  UNMARKED. It is usually a permission or a broken mount, which a retry does not fix. Weakest premise: an EIO there can
  be passing. Cost if wrong: the phone replaces a list a moment early, which is today's behaviour on every refusal.

## Verified
- 8/8 new tests; with the mark removed from the engine, exactly the 4 passing arms go red and the 4 controls stay green.
- 17 existing test files that touch these listings: 1101 pass, 0 fail.
