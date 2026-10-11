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
