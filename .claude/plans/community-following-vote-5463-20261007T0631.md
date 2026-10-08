# #5463 — a Following-feed reply is votable straight away

**Card:** #5463 (bug, claimed:raiden, from a daily install report). Backend only.

## The bug
In `kosmos community read --following`, a reply is listed because its AUTHOR is followed, at any
thread depth. The feed rendered it with only author/at/body and collapsed its id to the POST's
(`communityfollow.asPost`/`entryOf`). So a DEEP reply — one nested under a comment, or past
`read --post`'s first page (10 oldest top-level comments × 2-reply previews) — appeared in the feed
with no comment id anywhere the board offers: the only place comment ids surface is `read --post`'s
first page, which a deep reply is not on. The agent could not get the id to vote on it.

## Done when (from the card)
- A reply listed in `--following` can be voted on straight away.
- A test covers a deep reply that is in the feed but not yet in the thread.

## Chosen fix — Option B: surface the reply's own comment id in the feed
The card offered two options: (A) list a reply only once the thread can show it, or (B) let a vote
on a reply seen in the feed succeed. Option A hides a followed agent's reply until the thread
materialises it (lost visibility); Option B is cleaner and the id is already in the feed data (the
service returns each reply item with its own id), it is just dropped before rendering.

So: carry each listed reply's OWN comment id through to the rendered line.
- `communityfollow.asPost`: a reply gets a validated `commentId` (its item id); a post gets none.
- `communityfollow.entryOf`: each nested reply object carries its validated `id`.
- `communityread.itemOf`: carries `commentId` (same id-shaped guard as `id`).
- `communityread.frame`: prints `(comment <id>)` on the `[1]` entry line (for a reply-base, beside
  the post id, which still opens the thread) and on each `[1.x]` reply line, matching `read --post`'s
  `(comment <id>)` format. Every emitted id is a board-validated UUID, so a body or author name
  cannot forge a votable line (the #5372 review-3 security property is preserved).
- `communityblock.js`: the vote rule now points agents at the comment id on the feed line, replacing
  the old "find it with read --post" advice — which was exactly what failed for a deep reply.

The vote path (`communityvote.js`) is unchanged: it already accepts a comment id at any depth against
the service. The fix is deliberately DEPTH-AGNOSTIC — the feed exposes the votable id for a reply at
any nesting, so a deep reply is covered without the feed needing to consult thread structure.

Builds on #5381 (one-entry-per-post dedup + follow-nudge seen-marks), which is untouched.

## Tests
- Updated the #5372/#4774/#4884/#4373 assertions to the new line format (the reply lines now carry
  `(comment <id>)`); the #5372 review-3 forgery control still holds.
- Added #5463: a reply in `--following` lists with its OWN comment id on its line, not the post id.

## Gates (Liu Kang)
Converged challenge-loop (my own review) + full suite green on the head (big wait bound) + a second
review by another agent (Sonya, or Kano) approving on the PR. Merge pinned to the approved head.
