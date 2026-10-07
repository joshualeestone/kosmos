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
   network or FUSE mounts; EISDIR is libuv's name for Windows' ERROR_INVALID_FUNCTION) still saves; any other
   flush error (EIO, ENOSPC) fails the save as before.
2. `repairTornRecords`, run at the start of every exclusive section (before the pending retirements land): a
   `sent.json` or `comments-sent.json` that is empty, or zero-filled at no more than the 3 bytes of an empty record
   (`{}\n`), is reset to `{}` when this service's
   `keys.json` holds no agent at all (missing, or an empty object). With no key nothing can have been posted or
   commented, so `{}` is the truth and nothing is sent twice. The size limit is a second guard (blind review 3), on
   NTFS only: there (measured) a torn file keeps the length of the write that was cut off, so a `sent.json` that held
   rows is longer and is never reset, even if a person removed `keys.json` after a crash tore both. Other file
   systems (ext4, XFS) can leave 0 bytes whatever the file held; there the keys check is the only guard. The check and the write are
   synchronous, so nothing else in this process runs between them.
3. `kosmos community status` no longer says "look again shortly" for an unreadable record; it says to tell the
   person if it stays, and that the board's log names the record.

4. A corrupt `keys.json`, `sent.json` or `deletes.json` is no longer advised "repaired or removed": removing one
   sends again (every agent under a second public name, every post already sent, or a post the owner removed).
   Each now says "repaired (do NOT remove it)", as comments-sent.json and comment-deletes.json already did, in any
   service's folder (matched by file name: the retirement pass reads other services' folders).
   The advice for state.json and the retire files is unchanged; what removing those does was not examined here.

## Decided, not missed

- Never reset `keys.json`, torn or not: that would give every agent a second public name. A torn `keys.json`, or a
  torn `sent.json` once any agent has a key, stays paused for a person, as before.
- Only empty or all-NUL counts as torn. Any other unreadable content (`{ not json`) is still left for repair; the
  existing test "an unreadable sent, keys or deletes file pauses sending and is left for repair, never reset" holds.
- The card's ask 3 (the post-time answer "not sending right now" when the switch is on) needs a reason from
  `willSend` through both routes and both CLIs: filed as #5435 rather than widening this change.
- The class: of the 84 non-test files in `engine/` and `server.js` that call renameSync at origin/main, 81 contain
  no fsyncSync (80 with this branch). Counted per file, not per write.
- Only this service's folder is repaired. A torn record in another service's folder (an old community address)
  still holds a retirement there until a person repairs it. Filed as #5434 (one shared helper), not
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
- The folder flush: Windows cannot flush a folder, so there it is ignored; elsewhere a failure is logged once.

## Verification

- engine/communitysend.test.js, ten #5431 tests: the repair with no keys (sent.json at 3 and 0 bytes, and
  comments-sent.json); no reset once a key exists, for sent.json and for comments-sent.json; no reset with a
  keys.json holding only a retired account; a torn keys.json never reset; no reset of a zero-filled record longer
  than an empty one (5000, 5 and 4 bytes; at 5, keys.json removed after a sweep that sent); a corrupt keys.json,
  sent.json or deletes.json is advised "do NOT remove it"; a save on a file system that refuses flushes (EINVAL,
  ENOTSUP, EISDIR) still goes; a failed
  sent.json flush leaves no temp file; every record flushed before its rename.
- Mutations, each red: the repair call removed; the keys check removed; the keys check applied to sent.json only;
  an unreadable keys.json read as empty; retired entries ignored; the size limit removed; the old keys.json advice;
  the fsync removed; the unsupported-flush tolerance removed; the temp-file cleanup removed.
- Every community test file: the count and result are in the proof.
