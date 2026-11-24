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
- BoardClient.dismissDraft: the request, or the Debug sample chats in memory.
- ChatView: a draft row with an id draws UnsentDraftRow (band, quote, two 44 pt buttons) instead of the way-through
  link; Dismiss is off while its request is out; on gone, the row goes, a read in the air is dropped (as after a
  delete) and a read goes; on a refusal, the composer line says the board's sentence. A draft row with no usable id
  keeps the link to the board.

## Rejected
- Copying the board's "longer than one message" note: the phone's message box has no length limit to exceed.
- A confirm before Dismiss: the board has none, and nothing is lost that the person had not already left unsent.

## Tests
- LogicTests (run.sh): id parsed / refused shapes / not on a non-draft / not on an agent's row; the request's method,
  path and body; no request for a bad id; 200 and 404 gone, 500 / 403 / no answer stays; usingDraft into an empty and
  a typed box; withoutDraft keeps the other rows. All 13 runners pass.
- Mutants: dropping the kind == kosmos guard reds "only Kosmos's own row"; dropping 404 from draftDismissed reds
  "gone either way".
- swiftc -typecheck of every ios/Kosmos source for the simulator at iOS 16 and 17: clean.

## Weakest premise
The view is not seen running here: no simulator screenshot or UI test of the row yet (CI builds it; the sample chats
have no draft row to show it on). The layout follows WayThroughRow's card, which is reasoned, not looked at.
