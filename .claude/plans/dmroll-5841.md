# dmroll-5841: a conversation at the message cap rolls over instead of stopping (kosmos#5841, piece 2 of 2)

Stacked on dmolder-5841 (piece 1, PR #5853), whose older route this pages across.

## Measured (on the card)
`engine/chat.js` MAX_MESSAGES = 1000 per thread file. Past it, `appendMessage` refused to record, for good: every
later send was delivered and not kept. The stated reason was that rotating would delete the person's oldest words.

## Change
- **At the cap:** `appendMessage` calls `supersede(..., 'full')` and starts a fresh file.
  - `supersede` RENAMES the file aside as `<file>.<stamp>.<pid>.<ms>.full`; nothing is deleted, so the reason for
    refusing still holds.
  - The fresh file carries `continues: <that name>` and keeps `projectBornAt`. It records the message.
  - If the move aside fails, the send is refused as before, saying why.
- **`readThread`** returns `continues`, and every write keeps it.
- **`asideChain(projectId, agent, withRows)`** walks the files a conversation continues, oldest first.
  - It follows a name only if it is this thread's own `.full` aside: the same directory, the thread file's name as
    prefix, and no separators.
  - A cycle or a broken link ends the walk.
  - A count-only walk caches each file's count and link, because a `.full` file is never written again.
- **Server:** the direct thread route's `olderCount` adds the chain's counts, so "Show earlier messages" stays after a
  rollover. The older route serves positions across [all asides, then the current file], oldest first.
  - Positions still count from the oldest message. A rollover moves rows between files without changing a position.

## Decided
- **Roll over rather than raise the cap.** A bigger file only moves the wall, and every append re-parses the whole
  file.
- **Project threads roll over too,** so they never stop recording. They have no earlier reader yet (out of scope).
- **The owes line and notices read the current file,** which holds the newest rows; they need nothing older.

## Weakest premise
That nothing deletes or rewrites a `.full` file once it is set aside. The count cache rests on it. Nothing in the
engine writes one, but a person could.

## Verify
- `node --test server.dm-rollover-5841.test.js`:
  - the message past the cap is recorded, and the full file is kept whole;
  - the thread route counts the chain (CONTROL: a short thread has 0);
  - paging crosses files in order;
  - a second rollover chains;
  - a forged `continues` is not followed;
  - a failed move aside refuses.
- `engine/chat.test.js`: its cap test now asserts the rollover.

## Review 1 (opus): rollover CARRIES the last 200 rows (decision on the card)
- **Why:** a fresh file holding only the new message broke every reader that looks at recent rows in the current
  file: the first-reply nudge (it would tell the agent nothing had reached the person), reactions, replies, held
  deliveries, `kosmos inbox`, and the project panel's history.
- **Change:** the full file is still set aside whole. The new file starts with a COPY of its last 200 rows, plus
  `carried: 200`. Position of row i = (earlier files' own rows) - carried + i, and the chain skips each file's carried
  overlap, so nothing doubles or shifts.
- **Also fixed:**
  - the chain is read off the SAME read of the current file, so a rollover between two reads cannot double the rows;
  - an EMPTY current file with this thread's own `.full` files on disk (a crash after the rename, or a damaged file
    set aside) continues from the newest one;
  - the project route counts the chain;
  - a reply to a row that lives only in an earlier file is found read-only;
  - a reaction on such a row says it is in an earlier part, kept as it was (earlier files are never written);
  - forget's count skips `.full` files;
  - the comment placement and the "no file read" overclaim are corrected;
  - the traversal test now points at a real file, so the name check is the only guard.
- **Not taken:**
  - `engine/dailylog.js` skips `.full` files and would prune days whose rows moved aside. Nothing calls it today; it
    needs care the day it is wired.
  - the unread count covers the current file only, and the carried rows cover the recent ones.
  - the older route re-reads every earlier file per page (a rare, explicit action).

## Review 2 (sonnet)
- **BLOCKER:** a project deleted and re-created under its name could reattach to the old project's `.full` file. Fix:
  the chain and the reattach require the same projectBornAt, and an other-project set-aside never reattaches.
- Carried overlaps are served from the NEWER copy (`chainRows`), so an edit made after a rollover survives paging.
- `carried` counts only on a file that continues another.
- **Mutants**, each failed its named test: older copy wins; projectBornAt checks removed; name check removed.

## Review 3 (opus)
- **Fixed:**
  - The routes disagreed when the chain stopped at a file that itself carried rows. chainRows now always drops a
    file's carried rows, as the counts do. Tested by corrupting the oldest file: every page is the range asked for,
    and paging to the start reaches exactly olderCount rows.
  - A cached count is trusted only while its file has the same size and modification time.
  - A DAMAGED current file in a rolled-over conversation now keeps its chain. Only an other-project set-aside starts
    over. The plan and the code now agree.
  - A failed write after the rename puts the full file back. My first version referenced a const that was out of scope
    in the catch, and its own empty catch hid it; a test caught it.
  - newestOwnAside orders by the rename time in the name, not mtime, which a restore or a copy moves (a test touched
    it).
- **Filed as its own card:** engine/dailylog.js skips `.full` files and would prune days whose rows moved aside.
  Nothing calls it today.
- **Not taken (NITs):**
  - a legacy project thread with no projectBornAt breaks its chain at its first rollover; it affects a count only,
    and project threads have no earlier reader;
  - a held message older than the 200 carried rows keeps "Held" in its `.full` copy.

## Review 4 (sonnet) + mutants for round 3's guards
- **Reviewer:** no blocker, no path that loses a message. Worked 1 and 2 rollovers by hand; both routes agree.
- **Test gaps, all fixed with a test each:**
  - the project route's chain count (reviewer);
  - a reply to a row only in an earlier file (reviewer);
  - "chain stops early" could not fail on a doubled carried overlap (reviewer's NIT, and mutant A survived it). It
    now pins the first earlier row to the readable file's first OWN row, and the last to the row before the tail.
    A no-duplicates/unbroken-run check alone still let A through: the gap fell before a non-numbered row.
  - each projectBornAt check on its own (chain walk, reattach). The reborn arm only went through the other-project path,
    so both mutants survived. Round 2's "projectBornAt mutants red" must have removed both at once.
  - a carried count past the file is not believed (mutant G survived).
- **Mutants, each red at its named test:** A (first file keeps carried), E (chain bornAt), G (carried bound),
  H (reattach bornAt), R (no earlier-file reply lookup), P (no project chain count). Earlier this round: cache
  size/mtime, oldest-aside-wins, no put-back, no name check also red.
- **The test server's keepAliveTimeout is raised** (piece 1's CI ECONNRESET came from ~400 sync appends between
  fetches; this file does ~1000).
- **Not taken (NIT):** a reattach after a crash or damage starts with carried 0, so the tail shows only new rows
  and the first-reply nudge may fire again until the thread refills. Nothing is lost, positions agree, and the
  crash window is between a rename and a write. Damaged-file rows written since the last rollover stay in the
  `.damaged` file, kept but not paged. Would change my mind: a report of the nudge repeating in practice.
