# msgqueue-5187: kosmos msg and the board say when a message is queued for a busy agent

kosmos#5187, assigned by Liu Kang (m4163). A message to a busy agent can sit queued and unread for its whole turn, while the sender sees Placed.
Measured on Mortals, 2026-10-03, with Antigravity CLI agents (Gemini 3.8 Flash). Claude Code interrupts on Enter mid-turn, whereas Antigravity buffers mid-turn input into user-queued messages above the composer ("Press up to edit queued messages"). Autonomous agents picking up consecutive tasks never end their turn, leaving queued messages marooned indefinitely in the terminal buffer while Kosmos previously reported Placed.

## Done looks like
1. Honest Delivery Feedback:
   - When a message is placed into an agent mid-task whose runner buffers mid-turn input into a queue (Antigravity), chat.deliver returns queued: true along with its paneNote.
   - kosmos msg and the Windows CLI report:
     "Queued with <to> (they are mid-task, so they will not read this until it finishes)."
   - If folded as a duplicate:
     "Queued with <to> (it had arrived the first time; it was not sent twice)."
   - Direct message logs in messages.jsonl record queued: true.
2. Board and Card Visibility:
   - status.classify scrapes Antigravity pane text for user-queued messages ("to edit queued messages", "user-queued messages", and "▸ [message from ...]").
   - The card on the board surfaces waiting counts ({ n, yours: 0 }) so web/index.html displays "N messages waiting" in stateReason.
   - reconcileReport preserves scraped.waiting when an agent reports working.

## Change
- engine/chat.js:
  - In deliverWithGap, compute isQueued = paneState === status.STATE.WORKING && !paneBackgroundWait && (allowed.card.runner === 'antigravity').
  - Include queued: isQueued on the DELIVERY.PLACED return value.
  - In deliverThroughChannel, return queued: false.
- engine/messages.js:
  - In sendWithDelivery finish callback, include queued: true in appendLog and return queued: true and paneNote to the sender.
  - In the recentSameSend duplicate fold arm, preserve queued: true.
- install/kosmos:
  - In cmd_msg, handle *'"queued":true'* to say "Queued with $to (they are mid-task, so they will not read this until it finishes)." and handle duplicate queued delivery.
- tools/windows/kosmos-cli.js:
  - In verbMsg, mirror the same queued and duplicate queued output sentences.
- engine/status.js:
  - Add antigravityQueued helper to parse Antigravity pane text for queued messages and count matches.
  - In classify for Antigravity panes, detect esc to cancel for WORKING, ? for shortcuts for IDLE, and attach waiting: { n, yours: 0 } when queued messages are present.
  - In reconcileReport working arm, carry forward scraped.waiting alongside reported.waiting.
  - Export antigravityQueued for testability.

## Measured
- engine/msgqueue-5187.test.js: 5 tests, all pass:
  - antigravityQueued parses single, multiple, and prompt-only queued messages from pane text.
  - classify detects working, idle, stopped, and queued waiting states for Antigravity panes.
  - reconcileReport preserves scraped.waiting when fresh or decayed.
  - chat.deliver returns queued: true for busy Antigravity agents, and queued: false for idle or Claude agents.
  - messages.send records queued: true in messages.jsonl and returns queued receipt and paneNote, preserved on duplicate retry.
- cli.msgqueue-5187.test.js: 6 tests, all pass:
  - kosmos msg reports queued status when busy.
  - kosmos msg reports duplicate queued delivery when folded.
  - kosmos msg reports standard Placed when not queued.
  - Windows kosmos-cli.js verbMsg mirrors the exact same three sentences.
- Doctrine checks pass:
  - cli.exit-code-mapping-3628.test.js
  - cli.sandbox-data-4796.test.js
- Focused suites pass:
  - cli.msg-stdin-2909.test.js (12 tests)
  - engine/chat.test.js (142 tests)
  - engine/messages.test.js (128 tests)

## Rejected
- Forcing Escape into the agent's pane automatically on every message: Escape aborts the current tool call or task execution, which could discard ongoing uncommitted work mid-edit. Surfacing the queue honestly on the CLI and board tells senders immediately while preserving safety.
- Changing state from 'placed' to 'queued': would break downstream clients, external tools, and existing tests that assert state === 'placed'. Stamping queued: true preserves backwards compatibility while giving full honesty.

## Weakest part
If an Antigravity pane's scrollback is deeply filled and the composer area scrolls completely out of view, antigravityQueued checks the tail of 35 lines. If more than 35 lines of rapid streaming output intervene between polls, the scrape depends on the presence of the queue prompt or the agent's turn completion. This is mitigated because Antigravity pins the composer and user-queued message box above the prompt bar at the bottom of the viewport.

## Decided, not missed
- Claude Code is not marked queued: Claude Code aborts generation on Enter and accepts the message immediately, as measured on version 2.1.289. Only runners that buffer input without interrupting (like Antigravity) are marked queued.
- Messages sent while an agent is in backgroundWait are not marked queued: the agent's own turn has ended and its REPL is sitting at the prompt, so the message is submitted immediately.
