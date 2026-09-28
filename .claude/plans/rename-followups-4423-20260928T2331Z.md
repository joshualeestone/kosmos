# #4423: the remaining surfaces that kept an old name or showed the id (Sonya Blade, 2026-09-28)

Follow-up to #4421 (PR #4437), built on its head and to be rebased once it lands (Liu Kang m2711).

## Finished means
Each item on the card is fixed (named at render time from the current card) with a test, except the community
identity, which is a decision for Renet and Josh, written on the card with my pick (comment 5880535290) and marked
needs_you on the board.

## Decisions, per item
1. **Reports-to menu** (built once at open, names the other agents): followCard repaints it from the fresh card
   every poll, only while it still shows the saved choice and is not focused (an unsaved pick is the person's).
2. **Pending "Replying to" strips** (DM and room; the name was copied at the Reply click): the sender is kept by id
   (`from`) and named at paint time (dmWho / pjNameOf); the DM strip's redraw key includes the name.
3. **Reactions tooltip** (the server lists reactors by session id): named by their card (tskAgentName, guarded),
   "you" kept.
4. **Recommender room notes** (names baked into the stored sentence): the note keeps its facts by session (`rec`:
   stuck, asked, because) beside the sentence; the room route re-words it with current names (noteTextNow, both the
   page's JSON and `kosmos room`'s text). Notes written before, and every other note, are served as stored.
   Rejected: rewriting stored notes (the log is a record), and templating on the page (old clients would show raw
   placeholders).
5. **Title line on a role-only change**: followCard repaints it every poll, written only when it changed.
6. **A former member's photo in the room**: the room row falls back to the board's card (guarded like dmRow's LAST).
7. **Community identity**: not built; decision on the card.

## Weakest part
Item 4 names each agent through readIdentity per note per room read; a room with very many recommender notes pays
that each poll. Cheap today (profile + one small file); a cache per read would be the fix if it shows.

## Checks
- web.rename-followups-4423.test.js: the page's real followCard, dmReplyPaint, pjReplyPaint, rxnsInner on real fleet
  cards; a source pin for pjRoomRow's fallback. Against #4437's page: 6 of 7 fail (the 7th is the fixture check).
- server.rename-followups-4423.test.js: a recommender note in a real room, a rename through the real route, both
  views name the new name; a note without facts is served as stored; malformed facts are not kept. With the route
  serving only the stored text, it fails.
- engine/recommender.test.js: runOnce passes the note's facts (stuck, the peers actually asked, the reason).
- Existing pins kept intact: followCard sits after paintBusy (web.reply-where's 3400-char window), and the meta write
  stays on the `metaBits.join(` line (server.test.js drives that slice).
