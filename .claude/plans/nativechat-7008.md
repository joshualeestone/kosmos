# nativechat-7008: a native chat with one agent on iPhone, read and send (slice 3a)

Card: kosmos#7008, the first part of slice 3 (Chat) in the native iPhone plan (#6838, plan comment 2026-10-21 14:25).
Design: Mona Lisa's slice 3a spec (`~/work/workers/monalisa/ios-design-2026-10-19/slice3a/SPEC.md`, on the card),
built from her 19 October p3-chat design and the board's own tokens.

## Finished looks like
Tapping an agent on the Agents tab opens its conversation natively: the name and status word (slice 2's tone) at the
top with an info button to the board, the messages as bubbles in the board's colours (runs with tails, times, day
lines), Kosmos's own lines quiet and centred, "··· <name> is working" while it works, and a composer that sends plain
messages, showing each at once and "Not sent. Tap to try again." when the Mac does not take it. What this part does not
draw (a question, a permission card, a file, older messages) is a way-through row to the agent's chat on the board.
Checked in the simulator; logic in ios/LogicTests. The real-iPhone check joins #6838's device list.

## Change
- ios/Kosmos/BoardLogic.swift: `threadRequest`, `sendRequest` (the board chat's own route, {text}, trimmed, at most the
  board's 10000), `parseThread` (who spoke, the way-through kind, not-sent rows, olderCount, a live question),
  `readThread` (the conversation, the Mac's own reason, or no answer), `chatItems` (runs and day lines), `dayLine`, `followKey`, `PendingSend` and `settled`, `sendResult` and `pendingState`, `notSentLine`, `sameWords` and `fitsBoard`.
- ios/Kosmos/BoardClient.swift: `thread(for:)` through the client's own session to the connected Mac; `post`, `retry`,
  `sendAgain`, `discard`, `settle` (sends are private); pending messages, drafts and sent-again marks per agent, dropped
  on sign-out, another account or another Mac; Debug-only sample chats.
- ios/Kosmos/ChatView.swift (new): the screen, the bubbles, the tail, the working line, the way-through row.
- ios/Kosmos/AgentsView.swift: a row pushes the chat (it used to open the board's chat in the web view); Debug-only
  `KOSMOS_SAMPLE_OPEN=<agent>` opens one at launch for screenshots.
- ios/LogicTests/main.swift: four sections (requests, reading, runs and day lines, sending).

## Decided
- The Mac keeps a row for every message it is sent (delivered, held or refused). A send waits for THAT row (by the time
  the Mac answers with) instead of drawing a copy of its own: held reads Waiting to send with nothing to retry (a retry
  would queue it twice), refused reads Not sent and is sent again from its row, once. Only a send with no answer keeps
  its own Not sent, and a read holding the same words (whitespace folded as the board folds it) clears it. Rejected: a
  local copy that is marked sent or failed (iteration 1 found it duplicated rows and could send twice).
- The status word and the working line come from the Agents list's own status poll, which keeps running while the chat
  is open (the list's stop is on the navigation view, which stays on screen).
- No pull to refresh (the spec); the chat reads every 3 seconds while open and stops in the background.
- iOS 27's glass back button shows the chevron only; the system style is kept, and the question is with Mona Lisa.

## Weakest premise
That a native POST to /api/agent/<name>/thread is taken through the Mac's tunnel like the board page's. The GET path is
the same mechanism slice 1's /api/status already proves; the POST is not yet measured end to end, because that needs a
phone signed in to Kosmos+. If the tunnel refused it, a send would show "Not sent" and the way-through row still
reaches the board's chat, so nothing is lost; the first TestFlight run is the measurement.

## Validation
- ios/LogicTests pass (the four new sections included).
- Simulator (iPhone 18 Pro, iOS 27), Debug build with sample chats, light and dark: ~/work/design-shots/kosmos-7008/.
- Release simulator build: no sample code (0 matches for each of three markers; the Debug build 1 each, the control).
