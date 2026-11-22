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
  It returns `{ text, path, notice, previous, wrote }`.
- Bound: the whole file, header and note included, is kept under `CHANGES_FILE_MAX` (4 x 32 KB) by dropping the oldest entries, and the file
  says which were removed and to read the sections their notices named in full.
- Header: one new sentence: each notice since the session started has its own entry, oldest first; the notice names
  its entry; a later entry wins over an earlier one.
- `lineFor(..., { notice })`: "listed in PATH, under Notice N (a pointer only: ...)"; from N = 2 a sentence after it:
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
- New `engine/instructionreread-noticeid-8912.test.js` (7): two landed notices give entries 1 and 2 and the line
  names Notice 2 with the earlier-entries clause; a line that did not land keeps entry 1 byte for byte and the next
  landed one is Notice 2 (CONTROL: no restoreChanges drops the file); a session start clears, next is Notice 1; a
  stranger's file at the path is not carried; a `+ ## Notice 5` diff line is not an entry; past the bound entries 1
  and 2 go and the file says so; lineFor with no number keeps the old sentence, Notice 1 has no earlier clause.
- Updated `engine/instructionreread-changes-7149.test.js`: the path regex allows ", under Notice N (...)"; the review
  13 chain now asserts the second notice is entry 2 with entry 1 above it (it asserted the old replace); three
  separate-case prepares in the 8743 tests drop the file between cases.
- Mutations, each red: overwrite as before (3), restore drops (1), no ownership check (1), unanchored heading (1),
  no bound (1), no earlier clause (1).

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
