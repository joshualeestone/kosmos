# unsentdraft-8958: an unsent draft natively in the iPhone chat (kosmos#8958 slice A)

## Goal
Slice A of kosmos#8958 (follow-up to #8952): the phone drew an unsent draft (text Kosmos took out of an agent's input
box, engine/chat.js draft rows, kosmos#6717) as a link to the computer's board. The board draws it natively
(web/index.html dm-draft): a band, the words quoted, "Put in the message box" and "Dismiss". Do the same on the phone.
Slice B (the task page's board-only actions) is a separate later PR.

## Change
- BoardLogic: ChatRow.draftId, parsed only on Kosmos's own draft row (kind kosmos, draft true) and only in the Mac's
  shape (12 hex, server.js refuses any other). The board's words (draftBand, draftUse, draftDismiss,
  draftDismissFailed). draftDismissRequest: POST /api/agent/<name>/unsent-draft/dismiss {id}. draftDismissed: gone on
  2xx or 404 (already dismissed), as dmDraftDismiss. usingDraft: words after what is typed, on a new line (trailing
  whitespace of the typed text dropped), as dmDraftUse. withoutDraft: the row out at once.
- BoardClient.dismissDraft: the request, or the Debug sample chats in memory. KOSMOS_SAMPLE_DRAFT=1 (Debug, off by
  default) adds a draft to Dana's sample chat for the design shots.
- ChatView: a draft row with an id draws UnsentDraftRow (band, quote, two 44 pt buttons) instead of the way-through
  link; Dismiss is off while its request is out; on gone, the row goes, a read in the air is dropped (as after a
  delete) and a read goes; on a refusal, the composer line says the board's sentence. A draft row with no usable id
  keeps the link to the board. Put in the message box says the board's "longer than one message" sentence at once when
  the box then exceeds Board.maxMessage (review 3: a draft can be up to 64 KB, engine/unsentdrafts.js). Review 1: the 44 pt frame and hit shape sit on each button's label (an outer frame on a
  bordered button left a smaller target); the busy mark is cleared before the epoch check, as reactTo.

## Rejected
- A confirm before Dismiss: the board has none, and nothing is lost that the person had not already left unsent.

## Tests
- LogicTests (run.sh): id parsed / refused shapes / not on a non-draft / not on an agent's row; the request's method,
  path and body; no request for a bad id; 200 and 404 gone, 500 / 403 / no answer stays; usingDraft into an empty and
  a typed box; a draft over maxMessage does not fit; withoutDraft keeps the other rows. All 13 runners in ios/LogicTests
  pass (run.sh, run-actions, -agentinfo, -composer, -files, -newtask, -orb, -pullrefresh, -room, -settings, -sweep,
  -taskpage, -tasks).
- Mutants: dropping the kind == kosmos guard reds "only Kosmos's own row"; dropping 404 from draftDismissed reds
  "gone either way".
- swiftc -typecheck of every ios/Kosmos source for the simulator at iOS 16 and 17: clean.

## Weakest premise
The view is not seen running here: no simulator screenshot or UI test of the row yet (CI builds it). KOSMOS_SAMPLE_DRAFT=1
puts one in Dana's sample chat for design shots, which are still to be taken. The layout follows WayThroughRow's card,
which is reasoned, not looked at.
Known and left: "Put in the message box" inside the kosmos#7348 refill window, on a draft whose words equal the message
just sent, is cleared by the refill guard (the press then does nothing). It needs that exact coincidence within the
window; changing the refill guard for it risks the case it exists for.
