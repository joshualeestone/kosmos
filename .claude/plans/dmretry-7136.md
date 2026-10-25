# dmretry-7136: the iPhone chat's failed line and Try again are the board's (#6720)

Card: joshualeestone/kosmos#7136 (a gap in #6838's native chat, filed by Mona Lisa).

## Finished looks like
On main, a `could_not` message in the iPhone chat reads "Message failed to deliver, try again." (or "Message failed to
deliver." where the board offers no retry), its reason only heard, and Try again sends the same row through `retry_of`
exactly when the board's dmFailedLine offers it (retryable, newest, no reply, no files, no wire), "sending…" while it
goes. Tested in the logic suite, pinned to web/index.html with a control, the route check covering the request.

## Design (decided)
- BoardLogic: ChatRow reads `retryable` and `retrying`; a `could_not` row (not a duplicate) is `notSent ==
  "Message failed to deliver"`; `Board.failedLine(row, newestMineAt:, flying:)` is dmFailedLine; `retryRequest` posts
  `{text, retry_of}` with the row's words as held; `retryResult` says what dmRetrySend says.
- BoardClient.sendAgain: one request through retry_of (no new pending bubble), marked going while in flight
  (`resending`, the board's DM_RETRYING), nothing while a press is in the air.
- ChatView: one FailedLineView under the bubble (both the text and the files rows), the time kept above it, the
  reason as the accessibility hint; a refusal is also said under the composer, any other outcome is announced.
- The pending bubble's own "Not sent. Tap to try again." (failed before the Mac had it) is unchanged.

## Rejected / changed on purpose
- The phone's resend of replies and files (#7071, #7083) is dropped for a row the Mac kept: the board does not offer it
  and the Mac refuses retry_of with a reply or files. Such a row now reads "Message failed to deliver." as on the board.
- "<name> isn't running on your computer" on a kept row is dropped (the board has no such state on this line).
- Tapping the bubble to retry is dropped; "try again" is the button, as on the board.

## Weakest premise
The view is compiled only by the simulator build and never run here: nothing has been seen on a real iPhone. The
real-iPhone check joins #6838's list.

## Checks
- ios/LogicTests/run.sh: the rule against fixtures, the request body, the result sentences, the client posting
  retry_of once with a second tap sending nothing, newest-only, replies and files not offered.
- ios.dmfailed-7136.test.js: the phone's words and rule pinned to dmFailedLine / dmRetrySend, with a control.
- server.ios-routes-6838.test.js: the request is found and the board answers it.
- Simulator build (xcodebuild -target Kosmos -sdk iphonesimulator).

## Status
- [x] code + tests (logic 1245/1245, pin 2/2, routes 5/5)
- [ ] simulator build
- [ ] challenge-loop
- [ ] PR
