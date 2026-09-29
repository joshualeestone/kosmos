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

## Review iteration 1 (opus): 1 BLOCKER, 5 WARNING, 1 CONVENTION, 4 NIT
- B FIXED: followCard sat between paintBusy and the #3958 pill comment that web.pill-remembered-3958 pins as adjacent;
  moved after refreshStartAffordance. Sweep now 31 files, each alone, 0 fail.
- W1 FIXED: the room strip was repainted only on a click or a project switch; paintRoom now calls pjReplyPaint every
  room poll, keyed (project, message, name) so the close button is not rebuilt each time.
- W2 FIXED: the menu (and the title line) compared with innerHTML read back, which a browser rewrites (`selected=""`,
  `&quot;`), so the menu was rebuilt every poll. Both compare with what they last WROTE (dataset). Test counts writes;
  the old comparison fails it.
- W3 FIXED: "untouched" is now "still shows what paintReportsTo last showed" (dataset.shown, set by paint and by a
  successful Save), not "equals the record", which stopped the menu for good when the record named an agent not in
  the list or changed elsewhere. Test for the removed-agent case.
- W4 FIXED: a source pin on the server's recommender wiring (opts passed through).
- W5 FIXED: noteTextNow takes one room read's cache, so each agent's identity is read once per read, not per note.
- C FIXED: noteTextNow moved above keepAgentReply's doc comment.
- N1 FIXED: the text-view edit did nothing (rows are already re-worded); reverted.
- N2 FIXED: if any name would be only the bare id, the note keeps the sentence it was written with (test; control).
- N3 NOTED: the former-member picture test stays a source pin (pjRoomRow's lift needs much of the room).
- N4 NOTED: web.reply-where's window was at 3379/3400 before this card; this card does not move it.

## Review iteration 2 (sonnet): 0 BLOCKER, 2 WARNING, 0 CONVENTION, 1 NIT
- W1 FIXED: Save marked the menu "shown" with the value read AFTER the request; a pick made during the request would
  read as saved and be repainted away. The value sent is read once before the request (reportsSent) and reused.
- W2 FIXED: a real-browser check of this card's own page behaviour, docs/browser-checks/render-rename-followups-4423.js
  (OPENED, STEADY, RENAMED, ROLE, PICKED). On #4437's page RENAMED and ROLE fail; with the menu compared against its
  own innerHTML, STEADY fails in Chromium (the read-back rewrite, measured in a real browser, not only argued).
- NIT FIXED: the redundant `res.ok` in that line is gone.
Sweep: 34 files (with the registration tests), each alone, 0 fail.

## Review iteration 3 (opus): 1 BLOCKER, 3 WARNING, 0 CONVENTION, 3 NIT
- B FIXED (measured in Chromium by the reviewer): opening the SAME agent again with an unchanged list kept a pick
  abandoned on the earlier visit, because the menu was written only on change; a later role-only Save would have
  cleared the reporting line. openDetail now forgets what the menu last wrote before painting it. Browser check
  REOPEN arm (the exact case); without the reset it fails.
- W1 FIXED: a pending DM reply on the just-opened agent's own message borrowed the previous agent's name
  (DM_ROWS_NAME is the last drawn thread's); passed only when DM_ROWS_OF is this agent. Unit case; control.
- W2 FIXED: nothing drove Save's marking of the sent choice. Browser check SAVED arm; removing the marking fails it.
- W3 FIXED: the unit fixture could not see the open path; REOPEN covers it in the browser.
- NITs FIXED: plan wording (the cache, the test count); STEADY also counts writes to the title line.

## Weakest part
Item 4 names each distinct agent through readIdentity once per room read (the per-read cache from review
iteration 1), on every room poll in both views. Cheap today (a profile and one small file); a short-lived cache
across reads would be the next step if rooms collect many recommender notes.

## Checks
- docs/browser-checks/render-rename-followups-4423.js: see review iteration 2 (real browser, with controls).
- web.rename-followups-4423.test.js: the page's real followCard, dmReplyPaint, pjReplyPaint, rxnsInner on real fleet
  cards; a source pin for pjRoomRow's fallback. Against #4437's page every behaviour test fails (the fixture check passes).
- server.rename-followups-4423.test.js: a recommender note in a real room, a rename through the real route, both
  views name the new name; a note without facts is served as stored; malformed facts are not kept. With the route
  serving only the stored text, it fails.
- engine/recommender.test.js: runOnce passes the note's facts (stuck, the peers actually asked, the reason).
- Existing pins: followCard sits after refreshStartAffordance (web.reply-where's 3400-char window reaches paintBusy;
  web.pill-remembered-3958 needs paintBusy and the #3958 pill comment adjacent), and the meta write stays on the
  `metaBits.join(` line (server.test.js drives that slice). CORRECTION: the first version said "kept intact" while
  it broke web.pill-remembered-3958 (review iteration 1).
