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
Second: the marker never archives the last day (a newer time is moved back to a day ago, and the response says the
time used). That keeps every ask an agent is still being told about (messages.HELD_ASKED_MAX_MS, a day) live, so an
agent's read dropping archived posts from its held list can never take one away. The cost: "everything before today"
late in the day archives up to a day less than asked. If Mona wants the exact time, the floor goes and archived asks
stay held instead.

## Proof
`server.room-archive-7365.test.js` (13 tests) and one in `server.roomread-seen-4926.test.js`, real rows through the real route. Mutation-proven: dropping the live-only
text walk, the live paging, the archive paging, the row marking, the count rule, the age rule and the future-time
refusal each turn it red (scratchpad mut.sh). Room sweep (33 files that read rooms or route lists): 1,058/1,058.

## Review rounds
1. (opus, 15:4x CDT) 0 BLOCKERs, 4 WARNINGs, 5 NITs.
   - (W) A room whose every row was archived told agents "Nothing has been said in this room yet": it now says
     everything so far is archived. Test, mutation-proven.
   - (W) A held post that got archived could never be cleared by an agent's read (#4926), since the read no longer
     shows it: archived posts are now dropped from the reader's held list too. Test in server.roomread-seen-4926, with a
     token-less control.
   - (W) The module comment claimed rows are in time order; they are in the read's string order. Comment now says what
     the run does (it ends at the first row not picked, so an odd time format keeps more live).
   - (W) No test for Undo leaving the automatic rule's rows archived: added (100 by marker, 50 after Undo).
   - (N) 4 KB body limit on the archive route; ISO times only (Date.parse reads '1' as 2001); one sort per read instead
     of two. Not done: pruning markers of deleted projects (a few bytes each).
2. (sonnet, 15:5x CDT) 0 BLOCKERs, 2 WARNINGs, 4 NITs.
   - (W) A marker file that was there but would not parse read as empty, and the next write replaced every other
     room's marker with that empty table. Writers now read strictly and refuse (503, nothing changed). Test with a
     cut-off file and a control. Lost updates between two writers cannot happen in one process: read, change and
     write run synchronously in one turn.
   - (W, deferred) "archivedCount can differ between the text and JSON reads": both split at the same boundary, worked
     out once over every row before the audience filter; each count is of the rows that view shows, and the JSON
     view leaves out agent-only notes. The all-archived line keys on there being no live line, which cannot happen
     while a live row exists (the cap is at least 1).
   - (N) A time must carry Z or an offset; up to a minute ahead is read as now; a comment that the text view ignores
     ?archive. Not done: the O(archived) held-post loop on an agent's read (a Set lookup per archived post).
3. (opus, 15:5x CDT) 0 BLOCKERs, 1 WARNING, 4 NITs.
   - (W, deferred) An agent's read drops every archived post from its held list, so a person archiving right after a
     post cancels that agent's reminder of it. Deferred as designed: Mona's confirm copy says archived messages leave
     what agents read here. Named as the second weakest premise above, with the one-line change if that is wrong.
   - (N) An agent-token-only POST to both archive routes is refused (403), mutation-proven by adding the route to the
     agent-token patterns; a comment that each view counts its own archived rows; the plan's test count; the comment
     on malformed entries being dropped by the next write.
4. (sonnet, 15:5x CDT) 0 BLOCKERs, 2 WARNINGs, 4 NITs.
   - (W) An unparseable marker file made Archive and Undo refuse forever (round 2's refusal). Now a file that reads but
     will not parse is moved aside (roomarchive.json.broken-<time>, bytes kept) and the write starts fresh; a file
     that cannot be read at all still refuses. Both arms tested and mutation-proven.
   - (W, deferred to a code comment) Two concurrent writers could lose an update: only the board process writes this
     file, and its read, change and write run in one synchronous turn.
   - (N) Comments at the code: the one-row-per-row map the marking relies on, and that the held-post drop includes asks.
     Not done: calendar-impossible dates ('2026-02-30'), which V8 rolls over to a real, harmless time.
5. (opus, 16:0x CDT) 0 BLOCKERs, 2 WARNINGs, 4 NITs.
   - (W) A broken marker file was moved aside before the write, so a failed write left no table: now copied aside.
   - (W) Raised again: archiving could take away an ask its agent had not been told yet. Decided instead of deferring
     again: the marker is held at least a day back (the life of a held ask), tested with an hour-old ask and
     mutation-proven. See the second weakest premise.
   - (N) The staleHeld comment in messages.js now says the read stops at the archive; the header says one undated row
     keeps a room live; the chmod test skips as root. Not done: pruning markers of deleted projects.
6. (sonnet, 16:0x CDT) 0 BLOCKERs, 2 WARNINGs, 3 NITs.
   - (W) Undo on a broken file with nothing to undo copied it aside and left it, so each press piled up a copy: it now
     replaces the file. Tested, mutation-proven.
   - (W) Removing a project left its marker, and project ids are reused: the DELETE route now drops it, beside the
     other per-project cleanups. Tested with a control room, mutation-proven.
   - (N) roomarchive.js is on the #5434 list of owner-only writers (writeSecret at 0600, no hand rename). Deferred: a
     content-type check (the sibling Reopen route has none; cross-site writes are refused before routing), and a
     mixed time-format test (a row in another format ends the run early, the safe direction, as the header says).
7. (opus, 16:0x CDT) 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs: converged.
   - Fixed after it, wording only: the comment and test titles said "moved aside" where the code copies.
   - Not done: clearing a marker on project create as well as removal; a test pinning row alignment next to a
     filtered agent note; skipping the held-list push when nothing is held; a stray copy left if a write fails after
     copying a broken file aside.
