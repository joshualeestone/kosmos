# roomarchive-7365: a project room with thousands of messages stays usable (kosmos#7365)

## Why
A user has a project room with 5,500+ messages that is "almost unusable" (Josh 10-27). Measured on a seeded room
(card comment 6449412866): the server read was 398 ms (fixed in slice 1, now 31 ms). The page fetches the whole room every
5 s and rebuilds every row's HTML even when nothing changed: 2.2 s frozen per poll, 3.3 s per search keystroke,
185,899 DOM nodes. Rooms have no older-message loading at all; Direct conversations do (#5841, #6086).

## Decided (on the card)
- Mona's 12:47 design is final (Splinter 12:50): one log plus a reversible marker, rule "30 days AND past 1,000", an
  "Archive older messages" action with confirm and undo, one search with an Archived tag that opens in place, the
  archive reached from a boundary row in the same panel, the iPhone the same.
- NO "Show earlier messages" button: earlier pages load on scroll to the top (Josh 10-13, #6086).
- Order: the speed fixes ship first, with no archive in them.

## Slices
1. DONE (3f8aca64ef): the room read groups reaction rows once (398 -> 31 ms at 5,500 posts).
2. The page draws only the newest 200 rows; earlier pages load on scroll to the top.
   - Poll: GET /api/project/:id/room?n=200 (the paged arm, #7032), not the whole room.
   - Scroll back: reaching the top of the loaded rows asks for ?n=200&cursor=<oldest loaded key>, prepends it, and keeps
     the reader where they were (anchor the row they are on, as setThread does for DMs, #1926).
   - Held older pages stay while the same room is on screen; another room resets them (as EARLIER does per agent).
   - A gap: if more than a page of rows arrives between polls, the rows between the held older pages and the newest page
     are fetched by cursor (the DM's earlierFillGap shape), so nothing falls between.
   - Search: while the room search box has text, the room is fetched whole and filtered as today, so search still finds
     every message. (Slice 3's archive search replaces this.)
   - Proof: page timings on the 5,500 fixture against the 500 control (scratchpad roomprof/runpage.sh), and page tests
     lifting the merge and the scroll trigger (test-support/page.js).
3. Archive, to Mona's design: the marker, the rule, the action with confirm and undo, search with the Archived tag, the
   boundary row, `kosmos room` reading the live part only, the iPhone.

## Weakest premise
The fixture's row shapes are a guess at a typical room. Heavier real rows (attachments, tables, quoted replies) make the
page cost worse, which makes the window more urgent, not less.

## Review rounds
