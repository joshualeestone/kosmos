# dmolder-5841: reach a direct conversation's earlier messages (kosmos#5841, piece 1 of 2)

## Measured (on the card)
- A direct thread is shown 200 at a time (`server.js` TAIL = 200). The page says "N older messages are still kept"
  and offers no way to them.
- The engine also caps a thread at 1000 (`chat.js` MAX_MESSAGES). There, recording is refused for good. That is
  piece 2 (rollover), which builds on this reader.

## Change
- `GET /api/agent/<name>/thread/older?before=<n>` returns up to 200 messages before position n, oldest first, plus
  `olderCount`.
  - n is counted from the OLDEST message. The thread route's `olderCount` is exactly the first row it shows, so a send
    in between cannot shift a page.
  - It uses the thread route's gate (`nameRefusal`) and reads the same file.
  - A missing or bad `before` is refused with 400. A position past the end is clamped.
- `dmServeRows` is now the single rule for what a person sees of a direct thread's rows: the guide's mask (#3769),
  reaction pills (#3650) and previews. The thread route and the older route both use it, so an earlier page can never
  show what the latest one hides.
- Page: the older line gains "Show earlier messages". It opens an "Earlier messages" section above the thread, in its
  own element so the 5 s repaint cannot wipe it.
  - The section is drawn with `dmRow`.
  - "Show earlier" pages back to the start, and "Hide earlier messages" closes it.
  - Another agent on screen resets it.

## Decided
- The section opens above the thread in its own element, rather than prepending rows to the thread: the thread is
  redrawn from the latest 200 every 5 s.
- `before` is counted from the oldest end, not `skip` from the newest, because a thread only grows at the newest end.
- The live question and account rows stay with the tail only.

## Weakest premise
That this 200-row view is the limit the reporter meant. The card records both limits; piece 2 handles the 1000 cap.

## Verify
- `node --test server.dm-older-5841.test.js`: paging, a send between pages, clamping and refusals, the guide mask
  (with a control) and the name gate.
- The existing thread-route suites still pass (guide-secrets-3769, guide-mask-4733, dm-owes-4340,
  dm-notice-4354).
- `docs/browser-checks/render-dm-earlier-5841.js`.
