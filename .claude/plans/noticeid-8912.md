# noticeid-8912: each instruction-change notice has its own numbered entry (kosmos#8912, slice 2)

Stacked on cutnames-8912 (slice 1). The call for all four asks is on the card (comment 7087433333).

## Card ask 1
"Give each change notice its own identity (an id or timestamp, or an append-only log rather than an overwrite)."

## Before
One changes file per agent, fixed name, rewritten by every notice. The diff is against `seen`, which `passOnce`
advances after any delivered line (PLACED or UNCONFIRMED). So a notice whose turn never read the file (the agent hit
its limit) is replaced by the next notice's file, which diffs from AFTER it: that change is then in no file at all.
A line that did not land deleted the whole file.

## Change (engine/instructionreread.js)
- `prepareChanges(session, now)` reads the existing changes file only if it is exactly what Kosmos last wrote there
  (`readOwnChanges`: opened without following a link, a plain file no larger than 192 KB, starting with the title, and
  whose sha256 equals the hash Kosmos keeps beside the `seen` copy in its own data folder), splits it into entries (`entriesOf`, by
  `## Notice N, written HH:MM on D Mon YYYY` at the start of a line; every diff line starts with + or -, so it cannot
  look like one), and writes the header, the earlier entries and a new entry numbered one past the last.
  It returns `{ text, path, notice, previous, wrote, carried }`.
- Bound: the whole file, header and note included, is kept under `CHANGES_FILE_MAX` (4 x 32 KB) by dropping the oldest entries, and the file
  says which were removed and to read the sections their notices named in full.
- Header: one new sentence: each notice since the session started that names this file has its own entry, oldest first; the notice names
  its entry; a later entry wins over an earlier one.
- `lineFor(..., { notice, carried })`: "listed in PATH, under Notice N (a pointer only: ...)"; when the file holds earlier entries (`carried`), a sentence after it:
  "The entries above Notice N in that file are earlier notices since you started: read one only if you have not." No
  double quotes (the #5304 reader).
- `passOnce`: passes `prepared.notice` to the line; a line that did not land calls `restoreChanges(session,
  previous, wrote)`: only while the file is still exactly `wrote` does it put `previous` back (or remove the file when
  there was none), so earlier entries stay, and a session start during the send (which removes the file) is never
  undone. A caller with no `restoreChanges` drops the
  file, as before. `server.js` wires `restoreChanges`.

## Not changed, deliberately
- Every other path that drops the file still drops it (no copy, no diff, a held section, a debt that ends without a
  line, a session start). Earlier entries are only kept while every newer change is also in the file, because an
  earlier entry's + line may have been undone since, and only a later entry can say so.
- `seen` and the marks move exactly as before.

## Tests
- New `engine/instructionreread-noticeid-8912.test.js` (7 at first, 11 after round 1 and 12 after round 2 and 15 after round 3, the additions listed under Review): two landed notices give entries 1 and 2 and the line
  names Notice 2 with the earlier-entries clause; a line that did not land keeps entry 1 byte for byte and the next
  landed one is Notice 2 (CONTROL: no restoreChanges drops the file); a session start clears, next is Notice 1; a
  stranger's file at the path is not carried; a `+ ## Notice 5` diff line is not an entry; past the bound entries 1
  and 2 go and the file says so; lineFor with no number keeps the old sentence, Notice 1 has no earlier clause.
- Updated `engine/instructionreread-changes-7149.test.js`: the path regex allows ", under Notice N (...)"; the review
  13 chain now asserts the second notice is entry 2 with entry 1 above it (it asserted the old replace); three
  separate-case prepares in the 8743 tests drop the file between cases.
- Mutations: see the latest list under Review.

## Weakest premise
That an agent will read only the entry its notice names. The line says to, but an agent that re-reads the whole file
each time pays more than before; the bound (128 KB) caps that.

## Review
- Round 1 (opus): BLOCKER, `restoreChanges` restored without checking the file was still its own, so a session start
  during a failed send (rememberRead from the started report) was undone and pre-start entries came back as "since you
  started" (reviewer's probe). Fixed: `wrote` guard; test calls rememberRead inside deliver, with a CONTROL.
  WARNING, ownership by title only: fixed with the hash beside the `seen` copy, an O_NOFOLLOW open and a size limit;
  tests for a titled planted file and an oversized one. WARNING, the bound left out the header: fixed, and the test
  now asserts the whole file. WARNING, `none()` (no diff, a diff too large, an unusable path) and a held section still
  delete earlier entries: DEFERRED. It is the direction slice 2 does not change, and it errs safe: the line then names
  no file and says to read the sections themselves, so nothing is hidden, only a pointer is lost. Keeping the file
  there would let an earlier + line stand after a change the file does not show (the too-large and held cases), which
  is the misleading direction. The empty-diff case alone could keep it; not worth a separate path. NITs taken: the
  docstring, `clickDay` renamed `dayOf`, the two parentheticals in the line split into a sentence, a new entry ends
  with the same blank line a carried one does. NIT taken: tests for a held line, and UNCONFIRMED then a second notice.
- Mutations after round 1, each red: overwrite as before (5), restore drops (3), restore ignores a start (1), no hash
  check (1), no size limit (1), unanchored heading (1), no bound (1), no earlier clause (1).
- Round 2 (sonnet): WARNING, numbering restarted at 1 whenever the carried file was lost (the agent deleted or edited
  it, or the hash was unreadable), so "Notice 1" could name two different notices. Fixed: the last number is kept with
  the hash, so it continues; a session start clears both and restarts at 1. If the kept file itself cannot be written,
  both are lost and the next is Notice 1 (stated in the comment). The removed note now reads "Notice 1 is no longer in
  this file" (it was "removed to keep this file short", untrue when the agent deleted it). Test: the agent deletes its
  file, the next notice is Notice 2 and says Notice 1 is gone; CONTROL a session start restarts at 1. WARNING, the
  `none()` drops: a duplicate of round 1's deferral; the reviewer agreed it is safe and asked that the reasoning be on
  the card (it goes in the PR). NITs not taken: a microsecond window between restoreChanges' check and its write (a
  start landing exactly there is undone, as it always was before this change); no timezone in the stamp (it is read by
  an agent, on the board's clock); stacked slice tags in the header comment.
- Mutations after round 2, each red: overwrite as before (3), restore drops (3), restore ignores a start (1), no hash
  check (1), no size limit (1), unanchored heading (1), no bound (1), no earlier clause (1), counter ignored (3).
- Round 3 (opus): BLOCKER, `readPlain` opened the path without O_NONBLOCK, so a named pipe left in the agent's folder
  blocked open() and held the board's one thread (reviewer's probe hung over two minutes). Fixed: O_NONBLOCK, then the
  plain-file check; test runs prepareChanges and restoreChanges against a FIFO in a child process with a 15 s timeout.
  WARNING, a missed line after a deleted file reset the number (restore's dropChanges forgot it). WARNING, every
  dropChanges reset the number, not only a session start (the comment said otherwise). Fixed both: dropChanges removes
  only the file; rememberRead and forget also forget the kept hash and number; a line that did not land sets the number
  back to the one before its own (also when the file changed meanwhile, unless a session start forgot the hash: then
  nothing is touched). Tests: deleted file then a missed line then a landed one is Notice 2; a line with a held section
  (no file) does not reset the number. The tests that reset with dropChanges now reset with forget. NIT not taken: the
  sub-millisecond window between writing the file and keeping its hash (a start landing exactly there leaves an old
  number, so the next file says earlier notices are no longer in it, which errs safe).
- Mutations after round 3, each red: overwrite as before (3), restore drops (4), restore ignores a start (1), no hash
  check (1), no size limit (1), unanchored heading (1), no bound (1), no earlier clause (1), counter ignored (5),
  blocking open (1), restore forgets the number (1), drop forgets the number (1).
- Round 4 (sonnet): WARNING, from Notice 2 the line always said "the entries above Notice N", also when the file held
  none (after a dropped or deleted file). Fixed: prepareChanges returns `carried` (earlier entries kept) and the
  sentence needs it; the deleted-file test asserts the line has no such sentence, and lineFor is tested both ways. NIT
  taken: a comment on the empty-string hash restoreChanges keeps. NITs not taken: a test over the note strings for the
  heading claim (only Kosmos-written files are parsed, under the hash); the number is unbounded within a session (it
  resets at every session start).
- Mutations after round 4, each red: as after round 3, with no earlier clause (2) and carried always (1).
- Round 5 (opus): no BLOCKER or WARNING. NITs, recorded for a follow-up card: a start report that is not recorded
  keeps the file, so "since you started" can be untrue then; the header's "each notice has its own entry" overstates
  (a notice that names no file has none); readPlain's size check is from fstat, so a file growing during the read can
  pass the limit (the hash still refuses it); the entriesOf comment omits fence and blank lines; a dead optional group
  in three 7149 regexes; a caller without restoreChanges keeps the advanced number.
- Full suite at 444bff504e: 2 red, both repo guards on this change, not behaviour. #1732 (an fs.constants platform
  flag, unclassified): two INVENTORY rows for readPlain's O_NOFOLLOW and O_NONBLOCK, as server.js's download route
  has. #1777 (a test file that branches on a win32 host and nothing runs on Windows): the new test file is added to
  tools/windows-tests.js ALSO, so Windows runs it; only its FIFO arm skips there.
- Round 6 (sonnet): WARNING, the new test file now runs on Windows, and a temp folder with a space (a user folder
  such as First Last) makes prepareChanges name no file, so most of its tests would fail there. Fixed: those tests
  (and the FIFO one) skip with the reason when the sandbox path has whitespace or a quote; CONTROL measured with a
  spaced TMPDIR: 13 skipped, 0 failed; normal: 0 skipped. WARNING, the header's "each notice since your session started
  has its own entry" (round 5's NIT): now "each notice since your session started that names this file". NIT taken:
  the three 7149 separate-case resets used dropChanges, which keeps the number; now forget. NITs not taken: readPlain's
  fstat-then-read size window (recorded in round 5); a weak last assertion in the stranger's-file test.
- Mutations after round 6, each red: as after round 4 (14 mutations).
