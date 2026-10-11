# dmolder-5841: reach a direct conversation's earlier messages (kosmos#5841, piece 1 of 2)

## Measured (on the card)
- A direct thread is shown 200 at a time (`server.js` TAIL = 200). The page says "N older messages are still kept"
  and offers no way to them.
- The engine also caps a thread at 1000 (`chat.js` MAX_MESSAGES). There, recording is refused for good. That is
  piece 2 (rollover), which builds on this reader.

## Change (as shipped; the review history below records how it got here)
- **Server:** `GET /api/agent/<name>/thread/older?before=<n>` returns up to 200 messages before position n, oldest
  first, plus `olderCount`.
  - n counts from the OLDEST message. The thread route's `olderCount` is the first row it shows.
  - The route uses the thread route's gate (`nameRefusal`) and reads the same file.
  - `before` must be digits only, and a value past the end is clamped.
- **Server:** `dmServeRows` is the single rule for a direct thread's rows, used by both routes: the guide's mask,
  reaction pills and previews.
- **Page:** the earlier rows are drawn IN `#d-dmthread`, before the latest, by `paintTalkThread`. EARLIER.rows is put
  in front of the thread's rows when it is open for the agent on screen and the latest read succeeded.
  - `paintOlderLine` draws the line with static "Show earlier messages" and "Hide earlier messages" buttons. While a
    page loads, Show is aria-disabled and keeps focus.
  - `earlierMore` loads one page older, puts it in front, scrolls the thread (never the page) to the first new row,
    and pauses read-aloud.
  - `earlierFillGap` fetches messages that left the latest 200 while the earlier rows are open.
- **Isolation:**
  - `earlierOn` draws earlier rows only for their own agent.
  - `paintTalk` resets the earlier rows before any await when a DIFFERENT agent comes on screen, so that agent starts
    closed. Coming back to the SAME agent keeps them until Hide (a snapshot, see below).
  - The `opening` counter drops a stale answer.
  - When the latest read fails, nothing draws earlier rows over the failure.
- **Snapshot:** the earlier rows are not refreshed by the 5 s poll. A reaction made here is written in. A preview, or a
  reaction or delivery change made elsewhere, shows after Hide and Show.

## Decided
- **Inside the thread, not a second box** (review 3). A second box misses every rule and handler keyed on
  `#d-dmthread`, and it left a gap.
- **`before` counts from the oldest end, not the newest,** because a thread only grows at the newest end.
- **The live question and account rows stay with the tail only.**
- **A thread that shrinks below the earlier rows closes them,** so nothing doubles. The test is applied only to a
  readable answer, because a failed read reports `olderCount` 0.

## Weakest premise
That this 200-row view is the limit the reporter meant. The card records both limits; piece 2 is the 1000 cap.

## Verify
- `node --test server.dm-older-5841.test.js`: paging, a send between pages, clamping, refusals, the guide mask with a
  control, and a borrowed name with a control.
- The existing thread-route suites still pass.
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

## Review 5 (opus)
- **Fixed:**
  - The two "read fails" arms could not fail for their guard: a 404 goes to paintTalk's catch arm, not the guard. The
    own-read arm now uses the shape the guard sees, a 200 with `messages: null`.
  - One failed poll closed the earlier rows, because the shrink test read a failed read's `olderCount` 0 as a shrink.
    That test now applies only to a readable answer, and a new arm checks that the rows survive a failed poll.
  - An earlier load finishing after a failed poll painted over the failure. `__readFailed` stops it.
  - `scrollIntoView` could scroll the page. The thread's own `scrollTop` now moves instead.
  - The "behave exactly like the rest" overclaim is now stated as a snapshot.
  - This plan's top half described the abandoned design; it now matches what ships.
- **Not taken (NITs):** the poll's cost with the whole kept thread open (up to 1000 rows through dmRow every 5 s),
  and older-route tests for pills and `reactionsTold`, which is shared code.

## Review 6 (sonnet)
- "Each agent starts closed" was true only for a DIFFERENT agent. Returning to the same agent keeps the rows, and
  the wording now says so; that behaviour is kept on purpose.
- A Show or Hide press inside the switch window acted for the last agent. The handler and earlierRepaint now require
  CURRENT to match.
- A gap fill re-checks the newest answer when it finishes.
- A comment whose words a scripted replace had swallowed is rewritten.
- **Not taken:** the `[data-at]` scroll lookup degrades quietly (the person stays at the newest). The unread edge would
  mark earlier rows as unread if UNREAD_EDGE_ON were turned on; it is false today.
