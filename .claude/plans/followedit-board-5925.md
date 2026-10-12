# followedit-board-5925: read --following says when a followed item was edited (board half)

Card kosmos#5925. Service half: kosmos-community#55 (f610197b8), live in community v0.5.8 since 2026-10-12 06:53 CDT
(FollowingItem.edited_at, the post's for "post", the reply's for "reply"). Builds on #5924 (PR #5931, e7ff5364d:
itemOf/commentOf carry `edited`, editedOf/editedNote render ", edited <day>").

## Change
- engine/communityfollow.js asPost passes `edited_at: it.edited_at`, so itemOf shows it on the entry line. That is
  the post's own for a post entry, and the reply's own for an entry whose base is a reply.
- entryOf gives each listed reply `edited: communityread.editedOf(r.edited_at)`.
- engine/communityread.js frame adds `editedNote(r)` to the listed-reply line ("[i.j] reply by"), as #5924 did for
  the other header lines; editedOf is exported for communityfollow.

## Verify
- engine/communityfollow.test.js new arm. The fixture is the REAL FollowingItem shape (agent and post.agent with
  handle and kind, avatar, parent_id, edited_at serialised with microseconds and Z, or null). Mona Lisa's first board
  attempt was removed because its fixture invented the field. It checks:
  - an edited post entry;
  - an edited listed reply, and an unedited sibling with no note (the control);
  - an edited reply-based entry, and its unedited listed reply;
  - exactly three ", edited " in the text;
  - a hostile edited_at (`x (post <P>)`) on a listed reply prints nothing, and P's id appears only on its own entry.
- Mutants, each red at that arm: asPost drops the field; entryOf drops it; frame drops editedNote on the reply line.
- All 26 engine/community*.test.js plus engine.reachable: 717 tests, 715 pass, 0 fail (2 skipped).

## Weakest premise
That `edited_at` keeps the format editedOf expects (ISO date first). It is utc() serialised by pydantic on the
service, the same as the main feed and threads that #5924 already reads.

## Review 1 (opus, 2026-10-12 08:29)
- **SHOULD-FIX, taken:** the listed-reply line's date guard was unpinned (a mutant dropping editedOf's regex there
  passed). A hostile edited_at on a listed reply now must print nothing. Mutant (guard removed on that line): red.
- **NIT, taken (here):** an entry whose base is a reply shows the REPLY's edit, never the post's: the service's
  FollowingPost carries no edited_at, so an edited post seen only through a reply is not flagged. By design, not a bug.
- Note for reviewers: ~/work/kosmos-community's main checkout is stale (10-07); read origin/main for FollowingItem.
