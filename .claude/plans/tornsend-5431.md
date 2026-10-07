# #5431: a crash-torn sent.json paused community sending with no end

**Branch:** `tornsend-5431` · **Card:** kosmos#5431 (found on the Windows orchestrator box, 0.7.22)

## The defect

`saveJson` wrote a temp file and renamed it into place with no fsync. After a crash NTFS kept `sent.json` at its
full length with zeroed contents (3 NUL bytes, the torn `{}\n`). `loadJson` rightly cannot read it, so every sweep
returned `skipped: 'unreadable'` from 2026-10-01 on, while status told the agent to "look again shortly".

## The fix

1. `saveJson` flushes the temp file (fsync) before the rename, and the folder after it. Windows cannot flush a
   folder, so there that failure is ignored; elsewhere it is logged once per folder and never fails the save. A
   failed write removes its temp file. A file system that does not support a flush at all still saves: EINVAL and
   ENOTSUP (some network or FUSE mounts), EISDIR (libuv's name for Windows' ERROR_INVALID_FUNCTION), ENOSYS (some
   FUSE mounts). Any other flush error (EIO, ENOSPC) fails the save as before.
2. `repairTornRecords`, run at the start of every exclusive section (before the pending retirements land, and unable
   to stop the section): a `sent.json` or `comments-sent.json` of exactly 3 NUL bytes (the shape the card found: the
   torn write of `{}\n`) is reset to `{}` when this service's `keys.json` holds no agent at all (missing, or an empty
   object). With no key nothing can have been posted or commented, so `{}` is the truth and nothing is sent twice.
   The check and the write are synchronous, so nothing else in this process runs between them.
3. `kosmos community status` no longer says "look again shortly" for an unreadable record; it says to tell the
   person if it stays, and that the board's log names the record.
4. A corrupt `keys.json`, `sent.json` or `deletes.json` is no longer advised "repaired or removed": removing one can
   send again (every agent under a second public name, posts already sent, or a post the owner removed). Each now
   says "repaired (do NOT remove it)", as comments-sent.json and comment-deletes.json already did, in any service's
   folder (matched by file name: the retirement pass reads other services' folders). The advice for state.json and
   the retire files is unchanged; what removing those does was not examined here.

## Weakest premise

That `keys.json` holds an entry for every agent that has ever sent from this service. Every engine path that
deletes an entry keeps a `retired:` copy or deletes only a mark that never had a key (checked by blind reviews 1, 2
and 7). A person who removes `keys.json` by hand, against the advice above, defeats it; the 3-byte limit is then the
only guard, and a `sent.json` that held rows was a longer write. What would change it: an engine path that drops a
key that had sent.

## Decided, not missed

- Never reset `keys.json`, torn or not: that would give every agent a second public name. A torn `keys.json`, or a
  torn `sent.json` once any agent has a key, stays paused for a person, as before.
- Only exactly 3 NUL bytes is reset. An empty (0-byte) file is left for a person: some file systems (ext4, XFS,
  possibly APFS) leave 0 bytes after a crash whatever the file held, so a 0-byte `sent.json` may have held rows.
  Any other unreadable content (`{ not json`) is left for repair, as the existing test "an unreadable sent, keys or
  deletes file pauses sending and is left for repair, never reset" holds.
- No advice offers `{}` as a way out of a zero-filled `keys.json` (review 7): with `sent.json` torn beside it, that
  would empty the keys check and the repair would then reset `sent.json` and send the window again. A zero-filled
  `keys.json` is a dead end for the person, and the status line says to fetch them; a dead end is preferred to a
  double post.
- Not reset, on purpose, though a crash can tear them the same way: `deletes.json` and `comment-deletes.json`
  (resetting would forget the owner's removals); `state.json` (its record of when this ON period began decides which
  posts are in the window); a retire request (it holds an old account's name).
- Only this service's folder is repaired. A torn record in another service's folder (an old community address)
  still holds a retirement there until a person repairs it.
- The card's ask 3 (the post-time answer "not sending right now" when the switch is on) needs a reason from
  `willSend` through both routes and both CLIs: filed as #5435. Until the first sweep after a restart repairs the
  file (the boot sweep runs within seconds), a post or comment made in that window is answered as not sending.
- The class: of the 84 non-test files in `engine/` and `server.js` that call renameSync at origin/main, 81 contain
  no fsyncSync (80 with this branch). Counted per file, not per write. Filed as #5434.
- Not done: surfacing a torn record on the owner's page (card ask 2b). The status line and the log now say it.
- Cost, not measured: every save now flushes the file and its folder (on macOS a full flush to the drive), and a
  sweep saves keys.json many times per agent. Correctness first; #5434 is where a shared helper can weigh batching.

## Verification

- engine/communitysend.test.js, twelve #5431 tests: the repair with no keys (sent.json and comments-sent.json at 3
  NUL bytes); no reset once a key exists, for sent.json and for comments-sent.json; no reset with a keys.json
  holding only a retired account; a torn keys.json never reset; no reset of a zero-filled record of any other
  length (5000, 5, 4 and 0 bytes; at 5 and 0, keys.json removed after a sweep that sent); a corrupt keys.json,
  sent.json or deletes.json is advised "do NOT remove it"; a zero-filled keys.json is too, with no `{}` offered; a
  save on a file system that refuses flushes (EINVAL, ENOTSUP, EISDIR, ENOSYS) still goes; a folder that cannot be
  flushed does not fail the save and is said once per folder (off Windows); a failed sent.json flush leaves no temp
  file; every record flushed before its rename.
- Mutations, each red: the repair call removed; the keys check removed; the keys check applied to sent.json only;
  an unreadable keys.json read as empty; retired entries ignored; the size limit removed; 0 bytes admitted; the old
  keys.json advice; the sent.json advice removed; the fsync removed; an unsupported-flush code removed; the folder
  failure thrown; the folder failure said every time; the temp-file cleanup removed.
- Every community test file: the count and result are in the proof.
