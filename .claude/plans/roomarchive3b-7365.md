# roomarchive3b-7365: the room archive on the page (kosmos#7365 slice 3b)

Base: local merge of slice 2 (`roomwindow-7365`) and slice 3a (`roomarchive3-7365`) onto main. Rebase onto main once
both are merged; do not push before then (it would carry two unmerged branches).

## Design (Mona, card comment 6449440652; nothing here is new)
- The live room scrolls back to a boundary row: "Older messages are archived" with a "View archive" link. It shows only
  when the reader has reached the start of the live history (olderCount 0) and archivedCount > 0, never as a standing notice.
- "View archive" switches the same panel into the archive: header "Archive · N messages · Undo · Back to the room",
  rows newest first at the bottom and earlier pages on scroll to the top (the same window code), bubbles a shade quieter.
- The room's menu gets "Archive older messages", with a confirm: "Archive messages older than [this week ▾]? They
  leave this room and what agents read here. You can still search and open them, and undo this from the archive."
  Choices: this week, this month, everything before today.
- Search: one list; an archived hit carries an "Archived" tag.

## Decided for the build
- **One switch in pjWinRead:** every live read sends `archive=0`, the archive view sends `archive=1`; both keep the
  cursor code as is (3a's cursors are shared across views). Each read stores `archivedCount` on PJ_WIN.
- **Archive view state is its own object** (PJ_ARCH: on, rows, cursor, olderCount, loading, because), reset by
  pjWinReset/openProject. While it is on, loadRoom's poll still reads the live newest page (unread counts, the working
  line) but does NOT paint the room; Back to the room paints the window from PJ_WIN and polls as before.
- **The boundary row is drawn by paintRoom** as the first row of the live room when the condition holds, so it moves
  with the rows and never floats. In the archive view, the top row says "This is the start of the room" when the
  archive's olderCount reaches 0.
- **Undo** posts `/room/archive/undo`, then leaves the archive view and re-reads (rows the automatic rule archives stay
  archived, and the count shown says so).
- **The confirm's time** is computed on the page in the person's zone (this week = 7 days ago, this month = 30 days ago,
  everything before today = local midnight) and sent as ISO with Z. The server keeps the last day live (3a's floor), so
  the confirm's wording must not promise more than that: show the time the server answered with in the receipt
  ("Messages before Tue 26 Oct, 4:10 PM are archived").
- **Search tag:** pjRoomRow adds `<span class="msg-archived">Archived</span>` beside the time when `m.archived`.
- **iPhone (3c, its own PR):** the phone's paged read sends no `archive` today and keeps reaching every message; 3c
  adds the boundary row and archive view in Swift.

## Proof to collect
- web tests lifting the boundary condition, the archive-view poll guard and the confirm's time math.
- A browser check (docs/browser-checks/render-room-archive-7365.js) on a seeded board: boundary row appears only at the
  start of the live history, View archive pages back, Undo restores, an archived search hit shows its tag. It must
  declare its surface tokens on line 1.
- design-shots for Mona (light/dark, desktop/phone).
- Run web.api-routes-3957 (new fetches need literal paths with '?' inside the literal) and both browser-check gates
  (tools/lib/browser-check-gate.sh, tools/lib/browser-check-surface-gate.sh) after every web/ commit.

## Weakest premise
That pausing the room's paint while the archive is open is safe for everything else loadRoom paints (the held strip,
the unanswered lines). Check each before building.
