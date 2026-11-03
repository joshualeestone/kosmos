# passingrefusal-7850: the board marks a passing listing refusal

Card: kosmos#7850 (follow-up to #7842). Owner: Ice Cream Kitty.

## Scope of THIS branch: item 1 only (the board)
- engine/projects.js: a failed read of a folder's entries (listFiles' top-level readdir, listDir's opendir and its
  entry reads) goes through unreadFolder: `passing: true` only for EMFILE, ENFILE, EAGAIN, EBUSY and EINTR; ENOENT and
  ENOTDIR say the folder is not there (lasting); any other code (EIO, EACCES, EPERM) is the same "could not read"
  sentence with no mark. listDir's "changed while it was being read" is passing only when the folder is still a folder
  with a new identity; gone or now a file after the read is the lasting "not there" sentence.
- listFiles' top-level read now rethrows TypeError/ReferenceError, as listDir and its own subfolder reads already did,
  so a programming error is not shipped as a passing refusal.
- server.js: unchanged. The agent Files list (200), agent browse (409 at the top, 404 below) and project documents
  (200) already send the engine's answer as it is, so the mark reaches all three.
- server.files-passing-7850.test.js: passing arms per route by error code, lasting controls with their exact sentence.

## Not in this branch, and why
- Item 2 (the phone, ios/Kosmos/FilesLogic.swift filesKeepsShown): PigeonPete's filesparity-7842 is open and rewrites
  that same function (iteration 6 of its loop). Building on main now would collide. It goes on top once #7842 merges.
- Item 3 (a quiet "could not be refreshed" line): with item 2.

## Decided
- A field, not a 503: a status change would move the browse route's 409/404 split the phone already reads, and an
  older phone reading a 503 would treat it as a server fault. A field is ignored by every client that does not know it.
- Marked by error CODE, not by which call failed (review round 1): an EIO from a dead mount or an EACCES from an ACL
  comes back on every poll, and marking it passing would keep a stale list on the phone with no end. The same reason
  leaves folderState's "we cannot read this folder" unmarked.
- Weakest premise: that the five codes are the passing ones. Cost if one is missing: the phone replaces a list a moment
  early (today's behaviour on every refusal). Cost if a lasting code were in the set: a list kept stale indefinitely,
  which is why the set is small.

## Verified
- 11/11 new tests. Mutation A (every mark removed): exactly the 5 passing arms go red. Mutation B (EIO added to the
  passing codes): exactly the EIO control goes red.
- 17 existing test files that touch these listings: 1101 pass, 0 fail.
