# msgdelete-7614: Delete on the person's own message, in the iPhone's long-press sheet (kosmos#7614, phone side)

Josh, 10-30: a compact Discord-style bar with Delete for the person's own messages, and the phone to match. The card is
Mona Lisa's; she builds the routes and the board bar (hoverbar-7614). The phone side is mine, agreed in Fleet Builders.
Route contract: her comment on #7614 (6522788480).

## Finished looks like
- In a direct message and a project room, the long-press sheet's last row is "Delete message", red, only on the
  person's own sent message: a DM row of theirs with its time; a room post with `operator: true` that is not in the
  archive. An agent's message, a Kosmos line, an outside message and an archived post never offer it.
- It asks first, in the board's words ("Delete this message? It goes from this conversation for everyone. Agents who
  already read it still remember it, and Kosmos tells them you withdrew it."), answers Delete and Keep it. Keep it does
  nothing. Delete runs once the sheet has gone.
- DM: `POST /api/agent/<name>/thread/delete {at}`. Room: `POST /api/project/<id>/room/<post id>/delete {}`. On
  `{deleted: true}` the row goes at once (the next read confirms); `told` non-empty puts "Deleted. <names> had already
  read it, so Kosmos told them you withdrew it." on the composer line. A refusal (403 not yours, 404 gone, 409 an
  earlier part of the conversation) puts the route's own words there.
- The sample chats delete in memory (Debug only).

## Decided
- An alert, not a confirmation dialog: on iOS 26+ a dialog is a popover that drops its cancel button, so Keep it did not
  show (seen on the iOS 27 simulator). Weakest premise: that this holds on every iOS the app supports; on iOS 16-25 an
  alert shows both answers too.
- Delete is not offered on the earlier, rolled-over part of a DM? It IS offered, and the route's 409 says why it cannot;
  the phone cannot tell a rolled-over row from its own data. Rejected: hiding it by a guess.
- The DM's names for the note come from the chat's own agent (only that agent can have read it).
- Merge only after Mona Lisa's routes are on main: before that the phone would offer Delete and get a 404.

## Not in scope
- The board bar and the routes (Mona Lisa). A task link on the phone (the board's "# 1357" is Copy message id).

## Review ledger
- Round 1 (before the 08:29 restart): VoiceOver's Delete, earlier pages drawn twice after a delete, standing lines kept. All taken (0ac2c71417).
- Round 2: a delete that works clears its own earlier refusal. Taken (221b534981).
- Round 3: 1 BLOCKER, 3 WARNING, 3 NIT. B: a late room read merged a deleted post back (rows only ever added); fixed with RoomStore.deletedPosts + Board.withoutDeleted on every write path, logic test with a control. W: system red 3.5:1 on the card, now Palette.dangerWord; chat read in the air brought the message back, now readShown = readsStarted; reply shape guessed, checked against origin/hoverbar-7614 server.js (matches). NITs: own-only refusal now said under the composer; VoiceOver Delete straight on the post REJECTED (it would skip the confirm; the sheet path always asks); room UI test not added (the sample room has no own post with an id the test can reach; the logic test covers the merge). Deferred, decided: a post deleted on ANOTHER device stays in an open phone room until reopened (needs a board signal).
- Round 4: 1 WARNING, 3 NIT. W: reset() kept deletedPosts (post ids repeat across computers); cleared, with a source check. NITs: sample room filtered too; earlier delete line always dropped; the mergeRoom argument-order NIT was a misread (shown first, page second, as written).
- Round 5: CONVERGED, no blocker or warning.

## Validation (after rebase on origin/main, 08:5x 10-30)
- LogicTests 1717/1717, room 741/741. DeleteMessageUITests 3/3 on a fresh iPhone-17e iOS 27.0 simulator (after round 4's code).
- Repo readers of ios/ 81/82: the one red is server.ios-routes-6838 naming exactly the two delete routes, which are on Mona Lisa's hoverbar-7614 and not on main. Expected, and it is the guard that keeps this from merging first.
