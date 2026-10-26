# restoreresume-5536: a stopped restore continues where it stopped (kosmos#5536 slice 3)

Design posted on #5536 (comment 6406039853) before building. Slice 2 (#7164) can stop a large restore part way (the
read route's hourly cap, a lapsed release, a full disk); until now a retry started from nothing.

## The call
- `engine/restoresink.js`, opt-in: `record: true` keeps `.kosmos-restore-record` in the root. Its first line names
  the snapshot; then a line per file (path, size, sha256 of the bytes the sink wrote), written and fsynced BEFORE the
  file is published, capped at 256 MB when written as when read (past it the record is dropped and `recordLost` says
  the restore cannot be continued).
- `resume: true` re-opens a non-empty root only after every existing root check, and only if it holds exactly what
  the record names: folders on the way to recorded files, and recorded files that re-hash to one of their lines.
  Names compare by backuprestore's `collisionKey` (APFS and NTFS fold case; HFS+ hands back NFD); two entries that
  are one name in NFC refuse. Links, other users' entries, entries open to others and second hard links refuse.
  File-browser metadata (.DS_Store, desktop.ini, Thumbs.db) is left in place and never read or trusted.
- A torn last record line (a power cut) is dropped and cut off; a write that fails part way is cut back to the last
  whole line, and that commit fails, so no file is published without its line.
- One recording sink per root: `.kosmos-restore-lock`, written whole then hard-linked into place, holding pid,
  thread, a token and the owner's start time (Linux: /proc start ticks plus boot id; elsewhere ps in a fixed locale
  and time zone). A dead or different owner's lock is taken over; a lock of this thread whose token no open sink
  holds is stale.
- `backuprestore` skips a file the sink already holds (no fetch, no budget; `alreadyHeld` counts them).
  `runRestore` leaves those files' chunks out of the read-grant plan.
- Without `record` or `resume` the sink takes no lock and writes no record. The one visible change for existing
  callers: this sink always has `has()`, so `restoreSnapshot`'s result from it now includes `alreadyHeld: 0`.

## Review rounds (blind, security-focused, one fresh reviewer each; stopped at the 8-round cap)
1. No blocker. W: write cap vs read cap; HFS+ NFD names; Windows record identity (O_NOFOLLOW is 0); record not bound
   to a snapshot. All fixed; NITs (modes, hard links, path cap) taken; one declined (clear temp folders after the walk).
2. W: case-only folder names never resumed on APFS/NTFS; a torn last line made the record unreadable. Fixed.
3. W: a part-written then failed record line glued the next one on; Finder's .DS_Store blocked a resume. Fixed;
   NITs: the lock, byte-measured cut, header.
4. W (my test wrote 0600, which no file browser does): real 0644 metadata, and a backed-up .DS_Store Finder rewrote.
5. W: a lock caught before its pid was written read as stale; a same-process lock after a worker ended. Fixed.
6. W: a crash mid-link left a two-name lock refused for ever; a lock from before a reboot with a reused pid.
7. W: pid reuse without a reboot; the boot rule moved by a clock step. Owner = pid plus start time.
8. W: ps prints start time in the caller's locale and time zone. Fixed (/proc on Linux, fixed env elsewhere).

## Rejected
- Resuming into any non-empty folder: the fresh-folder rule is what keeps a planted file or link untrusted.
- Keeping the record outside the root: it could then describe a different folder.
- Pinning workers: a recording sink is for a child process (stated in the header).

## Residuals, stated
- Two resumes started at the same instant after a crash can both take over a dead owner's lock (narrowed).
- Windows: pid plus the boot rule (fast pid reuse, Fast Startup not a boot). macOS: a large clock step moves ps's
  start time.
- A resume that then refuses has still cleared old temp folders (they hold only this sink's own half-written files).
- Not pinned by a mutation arm here: the NFC two-names check (needs a normalisation-sensitive disk; its test runs on
  Linux), a failed ps on a live pid, and the created-only record cleanup (the lock stops a second sink first).

## Weakest premise
That the lock is worth its complexity. Six of the eight rounds found lock edge cases. If a later caller guarantees
one restore per folder itself, the lock could shrink to a refusal on any existing lock plus a clear message.
