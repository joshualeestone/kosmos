# chatolder-7016: the native chat loads earlier messages in place (slice 3b, part 3 of 3)

Card: kosmos#7016. Parts 1 (questions and permissions, #7021) and 2 (files, #7023) come first. Design: Mona Lisa's
slice 3b spec, section 4 (~/work/workers/monalisa/ios-design-2026-10-19/slice3b/SPEC.md). The board's own code it
follows: web/index.html EARLIER, earlierFetch, earlierMore, earlierNearTop, earlierFillGap, paintOlderLine (kosmos#5841,
#6086). Route: GET /api/agent/:name/thread/older?before=N (server.js).

## Finished looks like
When the person scrolls to the top of what is loaded and there is more before it, the next page (up to 200) loads by
itself and goes above without moving what they are reading. While it loads, "Loading earlier messages…" with a small
spinner sits at the top. When it fails, the line says why (the Mac's words, or "We could not read the earlier
messages.") with Try again, and nothing loads by itself until it is pressed. At the start of the conversation
nothing is drawn at the top. Day lines run across pages. The "Earlier messages are on your computer's board" row is
gone.

## Change
- BoardLogic: `olderRequest`, `OlderRead` / `readOlder` (the answer must be the range asked for, else the thread
  moved), `Earlier` with `shouldLoadEarlier`, `startLoad`, `finishLoad` (moved once: start again; twice: a failure),
  `retryEarlier`, `gapPages`, `gapRows`, `shownRows`; `parseRows` (from `parseThread`) with an id prefix, so an
  earlier page's ids are by position and never clash with the latest read's.
- BoardClient: `olderPage` (dropped across a reset); a Debug sample for Cleo.
- ChatView: the top line, loading when the top is reached (only after the first scroll to the newest message has
  settled; a chat too short to scroll loads by itself), keeping the reader's place by the row that was first, and
  filling the gap when messages leave the latest 200 while the chat is open.

## Decided
- Earlier messages belong to one open chat, as on the board (`EARLIER` is per agent and reset by another): leaving
  the chat and coming back starts closed.
- The failure line uses the Mac's own words when it gave them (the spec), and the board's sentence otherwise.
- "Near the top" is the top of what is loaded (the marker LazyVStack realises as the reader reaches it), as on the
  board (EARLIER_NEAR_TOP, 120 px), rather than the spec's "within one screen". A fast scroll may stop at the top while
  the page loads; matching the board keeps the two the same.
- Settled means the newest message is really on screen, or the top has left it after the first layout (review 2 and 3:
  a fixed delay both loaded on a slow open and missed the real scroll-up).
- Rejected: loading on any appearance of the top. The first layout draws the top for a moment before the jump to the
  newest message, which would load a page on every open.

## Weakest premise
That `proxy.scrollTo(firstRow, anchor: .top)` after the prepend keeps the reader's place without a visible jump on a
real phone. LazyVStack measures rows as they appear, so a long page may settle a few points off. The real-iPhone check
joins #6838's list.

## Validation
- ios/LogicTests pass, with mutants for the range check, the moved-twice rule, the failure stop, the gap pages and rows,
  and the reset guard.
- Debug simulator build with -warn-long-expression-type-checking=100; Release has no sample code.
- Simulator (Debug samples; no tool here taps or scrolls, so KOSMOS_SAMPLE_SCROLLTOP=1 scrolls in code):
  - a short chat loads its earlier page by itself and keeps "Yesterday" in view (6-older-auto-light);
  - a 260-message chat opens at the newest message and loads nothing (6c-long-chat-opens-at-newest-light);
  - scrolled to the top, it loads the earlier page (6d-long-chat-scrolled-up-loaded-light);
  - a page ending on the same day keeps "Message 41" at the top as it lands (6e-page-lands-place-kept-light);
  - the loading line (6-older-loading-*) and the failed line (6b-older-failed-*), light and dark.
