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

- `mintId` appends `{id, at}` (a direct message) or `{id, project, at}` (a room post) before the id
  reaches any pane. A post that reached nobody appends `{id, gone: true}`.
- `loadIds()` runs once per board, lazily, from `mintId`, `pendingPost`, `withPending` and
  `nextIdForTests`. It raises `ID_HIGH` to the highest id in the file, and restores this hour's room
  posts that are not gone into `PENDING_POSTS` with `row: null, restored: true`. A reply to one then
  posts and cites it by id; with no row it cannot be quoted or read for claim lines, which is the
  honest limit of what the file holds.
- The file is then compacted to what it still needs (the restored posts plus a high-water row),
  through `securewrite.writeSecret` (owner-only, flushed, #5434).
- Every failure falls back to the log alone, which is the pre-#8178 behaviour, never a refusal.
- `resetForTests` removes the file (a test process never holds the real root, #5418).

## Rejected

- A `{kind: 'id'}` row in `messages.jsonl` itself (the card's first suggestion). It changes the
  record every reader walks, and doubles its rows.
- Persisting `ID_HIGH` alone. It stops reuse, but a reply to a post caught by the restart is still
  refused.
- Storing the post's text in the id file, so a restored post could be quoted. It copies post text
  into a second file for a one-hour window; citing by id is enough to stop the refusal.

## Weakest premise

That one board process owns the data dir. Two processes appending and compacting the same file
could lose a row in a compaction. Kosmos runs one board per install.

## Items 2 to 5 of #8178

Decided on the card, not built here: 2 (double quote scan) and 3 (quote origin by id) stand; 4
(wording) stands because it leaks nothing and tests pin it; 5 (DM party by session name) stands
because the worst case is the generic refusal sentence.

## Tests

`server.post-restartcite-8178.test.js`: a restart while the first post is still being typed
(refused, and m1 reused, on main), and the id file read rules (room, hour, gone, torn line,
compaction) with a control.
