# #4944: a DM shows in the thread AND the box while it sends

Card: joshualeestone/kosmos#4944. Josh, 0.7.16, 2026-10-01 21:13 CDT: "as soon as i hit POST, it shows in both
places for a second and then shifts around".

## Cause
#4092 draws the pending bubble at the press (`TALK_PENDING`). `sendTalk` cleared the box only when the POST answered
(`clearSent`), and said "Sending…" under the box as well. So the words were in two places for the whole flight, and
then the box and the line both emptied, which moved the thread.

## Change (web/index.html, `sendTalk`, `dmPendingRow`, `paintTalkThread`)
1. At the press, in the same task as the bubble: empty the box, but only when THIS send's bubble is on screen (a
   search filtering the thread, or no thread read yet for this agent, draws none) and the box holds exactly the sent
   text; retire a parked draft holding exactly that text. With no bubble, the box keeps the words and empties on a
   placed or kept verdict, as before (`clearSent`).
2a. Words put back are re-parked in `TALK_DRAFTS`, since a programmatic write fires no input event.
2. `restoreUnsent`: every arm that used to leave the words in the box puts them back: could_not, unconfirmed and not
   recorded, and a failed POST. Never over words typed since. Into `TALK_DRAFTS[sentName]` when the flight moved.
3. The line under the box stays empty during the flight; "Sending…" goes to the hidden `d-reply-say` announcer.
4. The pending bubble draws the reply header (`dmReplyHead`), adjacency taken from the newest kept row, so the kept
   row swaps in place.

## Not in scope, decided
- The project composers (`pj-post` room, `pj-say` thread) draw no pending bubble, so they never show the words
  twice. Emptying them at the press would leave the words nowhere during the flight. Porting #4092 to the room is
  a separate feature.
- Attachment cards and link previews are not drawn on the bubble, so an attachment send still grows when kept.
- could_not puts the words back even when the board recorded the attempt: the pre-#4944 arm never emptied the box,
  so the retry copy is what it always offered (check case 14).

## Validation
- New: docs/browser-checks/render-dm-send-clears-4944.js (20 cases), listed in docs/browser-checks/gated.txt so the no-URL runner includes it,, with render-dm-send-shows-now,
  render-dm-sendjump-4639 and render-dm-reply-4256, via queued-heavy on Agent1s.
- web.dm-send-shows-now, web.term-compose-967, web.links-everywhere unit tests pass; the inline scripts compile
  (negative control reds).
- Full unit suite before merge.
