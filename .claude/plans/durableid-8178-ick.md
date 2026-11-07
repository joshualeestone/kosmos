# durableid-8178-ick: kosmos#8178 item 1, ids survive a board restart

## Problem

A room post's id reaches members' panes before its row is written (#8165). The ids handed out
(`ID_HIGH`) and the posts still pending (`PENDING_POSTS`) lived only in memory. A board restart in
that window:

- refused a member's reply to a real post ("we could not find post mN ... may never have been
  recorded"), and
- let the restarted board hand the same id out again (older than #8165, from #4888).

## Decision

Keep the record's shape unchanged and add a sidecar, `messages.ids.jsonl`, beside `messages.jsonl`:

- `mintId` appends `{id, at}` (a direct message) or `{id, project, from, operator?, mentioned?, addressed?, at}` (a room
  post: names only, never text) before the id reaches any pane. A post that reached nobody appends `{id, gone: true}`.
- `loadIds()` runs once per board, lazily, from `mintId`, `pendingPost`, `withPending` and `nextIdForTests`. It raises
  `ID_HIGH` to the highest id in the file, and puts back this hour's room posts that are not gone and that the record
  does not name at all (a recorded or deleted post is the record's to answer for). Each comes back as a stand-in row
  with its room, author, whether it is the person's, and whom it named, and empty text. A reply to one records
  `replyTo` and is read as a reply to the real post; `withPending` leaves stand-ins out, so they are never quoted.
- With the record unreadable it only raises `ID_HIGH`, writes nothing, and reads the file again next call.
- Past 64 KB the file is compacted (the restored posts plus a high-water row, plus any line appended after it was
  read) through `securewrite.writeSecret` (owner-only, flushed, #5434). A board that stays up reads it again once it
  has appended 64 KB since its last read, so the file stays near that size while running, not only across restarts.
- A torn last line (a crash mid-append) is ended with a newline when the file is read, before anything is appended,
  so the next id is not written onto the fragment.
- Every failure falls back to the log alone, which is the pre-#8178 behaviour, never a refusal.
- `resetForTests` removes the file (a test process never holds the real root, #5418).

## Rejected

- A `{kind: 'id'}` row in `messages.jsonl` itself (the card's first suggestion). It changes the
  record every reader walks, and doubles its rows.
- Persisting `ID_HIGH` alone. It stops reuse, but a reply to a post caught by the restart is still
  refused.
- Storing the post's text in the id file, so a restored post could be quoted. It copies post text
  into a second file for a one-hour window; citing by id, with the names, is enough to stop the refusal.

## Weakest premise

That one board process owns the data dir. A second process (only dev tools load the engine outside the
board) compacting while the board appends can still lose a line in the instant between the re-read and
the rename; the re-read narrows that to microseconds and the 64 KB threshold makes compaction rare.

## Items 2 to 5 of #8178

Decided on the card, not built here: 2 (double quote scan) and 3 (quote origin by id) stand; 4
(wording) stands because it leaks nothing and tests pin it; 5 (DM party by session name) stands
because the worst case is the generic refusal sentence.

## Tests

`server.post-restartcite-8178.test.js` (9 tests): a restart while the first post is still being typed
(refused, and m1 reused, on main; the reply records replyTo), the file's read rules, a recorded and a
deleted id, a real reached-nobody post, the names on a restored post (repliesToPerson), an unreadable
record, a line appended during compaction, the first post after a torn line, and a board that stays up compacting.
Eight mutants (one per fix) each fail their test.
