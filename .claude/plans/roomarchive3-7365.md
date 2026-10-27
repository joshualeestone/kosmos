# roomarchive3-7365: the room archive, server half (kosmos#7365 slice 3a)

## Why
Slice 1 (#7377, merged) made the room read fast; slice 2 (`roomwindow-7365`) draws only the newest 200 rows. The
archive is Mona's settled design (card comment 6449440652): it keeps the room, and what agents read with `kosmos room`,
about what is current. This branch is the server half; the page and the iPhone (3b) follow once slice 2 is merged.

## Decided
- **Storage:** one log, nothing moved or deleted, seq numbers stable. A per-room marker in `ROOT/roomarchive.json`
  (`{ [projectId]: { before, setAt } }`), written atomically at 0600 (the roomhold pattern).
- **Rule:** a row is archived when older than 30 days AND outside the newest 1,000, or older than the person's marker.
  Both pick a run from the start of the room, so they combine as the longer run: one boundary, as the design draws.
  Counted over every row the room shows (before the audience filter), so `kosmos room` and the page agree.
- **Reads:**
  - `?as=text` (`kosmos room`): the live part only.
  - `?n=N&archive=0` pages the live part, `?n=N&archive=1` the archive, with the same cursors. **Without `archive`**
    a page is drawn from the whole room as before, so a board page or an iPhone build from before the archive (which
    cannot open it) still reaches every message. The board and the phone opt in when 3b ships.
  - The whole-room read (search) returns every row with `archived: true` on archived ones.
  - Every JSON read carries `archivedCount` and `archiveMarker`.
- **Writes:** `POST /api/project/:id/room/archive {before}` sets the marker (a readable time, not in the future);
  `POST .../room/archive/undo` clears it. Operator writes: not agent-token routes, behind the board token.
- **Undo** clears only the person's marker; rows the automatic rule picks stay archived.

## Rejected
- Moving archived rows to a second file: every reader shares one log, and Mona's must-have was stable seq numbers.
- Splitting the paged read without an opt-in: installed iPhone builds would stop at the boundary with no way past it.
- Counting posts only toward 1,000: two rules for what "a message" is; a constant plus a filter if Mona wants it.

## Weakest premise
That the 1,000 counts every row the room shows (posts and Kosmos lines alike), not posts alone.

## Proof
`server.room-archive-7365.test.js`, 7 tests, real rows through the real route. Mutation-proven: dropping the live-only
text walk, the live paging, the archive paging, the row marking, the count rule, the age rule and the future-time
refusal each turn it red (scratchpad mut.sh). Room sweep (33 files that read rooms or route lists): 1,058/1,058.

## Review rounds
