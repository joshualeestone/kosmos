# #5431: a crash-torn sent.json paused community sending with no end

**Branch:** `tornsend-5431` · **Card:** kosmos#5431 (found on the Windows orchestrator box, 0.7.22)

## The defect

`saveJson` wrote a temp file and renamed it into place with no fsync. After a crash NTFS kept `sent.json` at its
full length with zeroed contents (3 NUL bytes, the torn `{}\n`). `loadJson` rightly cannot read it, so every sweep
returned `skipped: 'unreadable'` from 2026-10-01 on, while status told the agent to "look again shortly".

## The fix

1. `saveJson` flushes the temp file (fsync) before the rename, and the folder after it where the system allows
   (Windows cannot flush a folder: the call fails and is ignored; there the rename is what NTFS journals). A
   failed write removes its temp file. A file system that does not support a flush at all (EINVAL, ENOTSUP: some
   network or FUSE mounts) still saves; any other flush error (EIO, ENOSPC) fails the save as before.
2. `repairTornRecords`, run at the start of every exclusive section (before the pending retirements land): a
   `sent.json` or `comments-sent.json` that is empty or only NUL bytes is reset to `{}` when this service's
   `keys.json` holds no agent at all (missing, or an empty object). With no key nothing can have been posted or
   commented, so `{}` is the truth and nothing is sent twice. It runs inside the exclusive section, so no other
   writer in the board races it.
3. `kosmos community status` no longer says "look again shortly" for an unreadable record; it says to tell the
   person if it stays, and that the board's log names the record.

## Decided, not missed

- Never reset `keys.json`, torn or not: that would give every agent a second public name. A torn `keys.json`, or a
  torn `sent.json` once any agent has a key, stays paused for a person, as before.
- Only empty or all-NUL counts as torn. Any other unreadable content (`{ not json`) is still left for repair; the
  existing test "an unreadable sent, keys or deletes file pauses sending and is left for repair, never reset" holds.
- The card's ask 3 (the post-time answer "not sending right now" when the switch is on) needs a reason from
  `willSend` through both routes and both CLIs: filed as #5435 rather than widening this change.
- The class: 80 of the 84 files in `engine/` and `server.js` that rename into place had no fsync at origin/main. Filed as #5434 (one shared helper), not
  done here.
- Not done: surfacing a torn record on the owner's page (card ask 2b). The status line and the log now say it;
  a page banner is #5434's per-store decision.
- Not reset, on purpose, though a crash can tear them the same way (blind review 2): `deletes.json` and
  `comment-deletes.json` (resetting would forget the owner's removals, so a removed post or comment could go out);
  `state.json` (its record of when this ON period began decides which posts are in the window); a retire request
  (it holds an old account's name). Each stays paused for a person, and the status line says to tell them.
- Cost, not measured: every save now flushes the file and its folder, so a sweep that saves keys.json many times
  waits on the disk each time (on macOS a flush is a full flush to the drive). Correctness first; #5434 is where a
  shared helper can weigh batching.
- `torn()` reads the first 4 KB and the whole file only when those are all zero, since `sent.json` grows without
  bound and the check runs at the start of every exclusive section.

## Verification

- engine/communitysend.test.js, eight #5431 tests: the repair with no keys (sent.json at 3 and 0 bytes, and
  comments-sent.json); no reset once a key exists; no reset with a keys.json holding only a retired account; a torn
  keys.json never reset; a 5000-byte zero-filled record reset and one with content past 4 KB not; a save on a file
  system that refuses flushes (EINVAL, ENOTSUP) still goes; a failed sent.json flush leaves no temp file; every
  record flushed before its rename.
- Mutations, each red: the repair call removed; the keys check removed; an unreadable keys.json read as empty;
  retired entries ignored; the fsync removed; the unsupported-flush tolerance removed; the temp-file cleanup
  removed; the torn check trusting its first 4 KB.
- Every community test file: the count and result are in the proof.
