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

## Review 1 (opus): what changed and what was decided
- **BLOCKER fixed:** another agent's earlier rows could stand under the next agent's name. That happened during the
  next agent's fetch, and for good if that fetch kept failing. `paintTalk` now resets the section before any await.
  The browser check has an arm where the next agent's read fails.
- The line's button is now STATIC and only toggled. Before, it was rebuilt every poll and took a keyboard user's
  focus. Hide no longer refetches.
- Earlier rows are READ-ONLY. The thread's reaction, reply and copy controls are wired to `#d-dmthread`, so in the
  earlier section every button becomes plain text. Line breaks and the dark bubble tail extend to the earlier rows.
- Reply headers render with the earlier rows in the lookup, so a reply whose original sits beside it names it.
- An open counter drops a stale answer, so Hide then Show during a load draws once. A failed load offers "Try again".
- `before` accepts digits only. The gate test now covers a borrowed name, with a thread on disk and a control.
- **Deferred:** search does not filter the earlier section, which is a separate, explicit opening of older messages.
  A search over all kept messages would be its own card.
- **For piece 2:** `before` is stable only because a thread grows only at its newest end. The rollover moves old rows
  aside into `.full` files, so the older route must then page across the asides, with positions re-based per file.
