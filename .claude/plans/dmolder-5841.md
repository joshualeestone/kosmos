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

## Review 3 (opus): REDESIGN. The earlier rows move INTO the thread
Seven warnings had one cause: a SECOND box drawn with the thread's renderer misses every rule and handler keyed on
`#d-dmthread`. That meant:
- styles: new-look bubbles, avatars, cursors;
- the attachment preview;
- menus that close on any click, which the box's stopPropagation blocked;
- on a phone with the keyboard up, the box squeezed the latest messages.
It also left a GAP: messages leaving the latest 200 while the box was open showed nowhere.

So the earlier rows are now drawn IN `#d-dmthread`, before the latest, by `paintTalkThread` itself (EARLIER.rows
concatenated in front of the thread's rows). They behave exactly like the rest: reactions, reply, copy, previews,
search, styling. Gone: the separate box, its CSS extensions, the read-only conversion and the click-stopping listener.

- **The line** (`paintOlderLine`, extracted from paintTalk) carries "Show earlier messages" and "Hide earlier
  messages" as STATIC buttons. While a page loads, Show is aria-disabled, not disabled, so focus stays on it.
- **The gap:** `EARLIER.end` is the position just after the last earlier row. When a poll's `olderCount` passes it,
  `earlierFillGap` fetches `[end, olderCount)` and appends it.
- **Kept from review 1:** the reset at the top of paintTalk before any await (no cross-agent rows, also when the next
  read fails), and the `opening` counter (a stale answer is dropped).
- Review 1's "search does not filter the earlier section" is moot: they are thread rows now.
- Browser check rewritten for the new shape: 16 PASS, with a CONTROL, the gap arm, a failing-read switch and focus.

## Review 4 (sonnet)
- **BLOCKER (mine):** the redesign restored `web/index.html` from a NEWER main than the branch base, so it carried
  #5836's task wording as if it were mine. I merged origin/main, and the diff against main now holds only this card's
  files.
- **Fixed:**
  - Read-aloud no longer speaks an old message when earlier rows arrive: `convPause` runs in More, the gap fill and
    Hide.
  - A reaction on an earlier row is written into `EARLIER.rows`, so a rewrite keeps it.
  - "Show earlier" scrolls the first new row into view and stops pinning to the bottom.
  - When the LATEST read fails, the earlier rows are not drawn, so the failure note shows.
  - A gap fill that gets nothing back leaves `end` alone.
  - A thread that shrinks below `end` closes the earlier rows, so nothing doubles.
  - On the last page focus goes to Hide.
  - "Agent spoke" now reads the latest rows only.
- **Mutants run against the redesign:**
  - With no gap fill, the gap arm went red.
  - With no reset at the top of paintTalk, only the come-back arm went red. Isolation is STRUCTURAL now: `earlierOn`
    draws earlier rows only for their own agent.
  - With both `earlierOn`'s session check and the reset removed, the "another agent ... only its own rows" arm went
    red. So the browser check does catch a cross-agent leak.
- **Not covered by the browser check, said plainly:** the read-aloud pause, the scroll into view, and the reaction
  kept in a snapshot. The harness's 5-row thread does not scroll, and read-aloud needs the conversation feature on.
  Each is a few lines and was read by review, not measured.
