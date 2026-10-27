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
It was not safe: review 1 found the early return skipped the speech stamps, the hold strip, pending posts and the reply
map. Fixed by moving the return to just before the rows are written.

## Review rounds
1. (general-purpose, 17:5x CDT 2026-10-27) 1 BLOCKER, 9 WARNINGs, 1 CONVENTION, 4 NITs; the BLOCKER, all WARNINGs, the
   CONVENTION and NITs 1 and 2 applied (24b6f23f1e).
   - (B) Undo read e.currentTarget after an await (null by then) and threw before leaving the archive: it holds the
     button first.
   - (W) the archive's early return in paintRoom skipped every state update: moved to just before the rows are written
     (test pins the order; mutation to the top reds it).
   - (W) pjWinReset closed the archive, and the poll resets the window on a gap read: decoupled (test, mutation reds).
   - (W) the poll's let-go measured the archive's DOM, and Back lost the reader's place: guarded, and the place is
     anchored on open and restored on Back.
   - (W) "everything before today" always became 24 hours back on the server: relabelled "everything older than a day".
     Mona's design said "before today"; noted for her design review.
   - (W) reply headers said "unavailable" for archived originals: "Original message may be in the archive" in the live
     room ("may": the page cannot tell archived from removed, the weakest part of this fix), and the archive view looks
     originals up among its own posts.
   - (W) a failed earlier archive page could not be retried: it uses the earlier-pages line with Try again.
   - (W) focus and announcements on every view change: focus to Back on open, to the message box on Back and Undo.
   - (W) Undo did not reset the window: it does, as Archive does.
   - (W) the tests and the check left the risky paths unproven: three source-order tests; the check gains a poll
     landing while the archive is open, archived-original headers, focus, Back's place, the "older than a day" time,
     and the final step asserts the archive is closed.
   - (C) indentation fixed. Phone width: still unmeasured until the design shots.
   - NIT 1 (a late poll restoring the old count): stored after loadRoom's generation check. NIT 2 (focus during the
     Archive request): moves to the Working line.
   - NIT 3 (the count says "messages" but counts every archived row) and NIT 4 (the archive view is a snapshot; a
     reaction made in it does not repaint): left, recorded. Kosmos lines in a room are rare and read as messages to a
     person; reactions in the archive are a follow-up if anyone asks for them.
   - Found by the sweep, not the reviewer: the confirm was a 42nd body child (web.consolidated-980), so it moved inside
     the room's section; the modal sweep needed its row; the check needed its four wiring lines.
2. (sonnet, 18:1x CDT) 0 BLOCKERs, 8 WARNINGs, 1 CONVENTION, 3 NITs; all applied.
   - (W) a gap read's pjWinReset zeroed the archive count for one poll after it was stored: stored after the gap block.
   - (W) every row in the archive view carried the Archived tag (the server marks archive=1 rows too): not inside the
     archive view (the browser check asserts none).
   - (W) inside the archive, an original on an unread earlier archive page said "unavailable": "further back".
   - (W) a reaction made in the archive was taken back off by the next archive page's paint: PJ_ARCH.rows is patched
     too.
   - (W) View archive had no busy state and no generation check: "Opening the archive..." on the line, a second press
     while a read is out does nothing, and a stale read never lands (executed test, mutation-proven).
   - (W) the archive functions had only source-order tests: a vm harness runs pjArchOpen, pjArchEarlier and
     pjArchClose (open and Back with the anchor restored and focus moved; a stale read; a failed page, no retry by
     scroll, Try again), each mutation-proven.
   - (W) browser-check gaps: Undo's toast and focus, a refused Archive (route 503), a failed earlier archive page and
     Try again (route 500 once), no Archived tag in the archive view, Tab containment, the cutoff line, and a 390 px
     pass for the header.
   - (W) the button promised an archive when nothing was old enough: after Archive the page reads the count, and with
     nothing archived it says so instead of the receipt.
   - (W) "this week" means seven days back, not a calendar week: the confirm shows the cutoff time beside the choice and
     follows it. The labels stay Mona's.
   - (C) Tab is contained in the confirm, and opening another project closes it.
   - NITs: no raw server reason in the failure line; a successful Archive is announced; a search closes the archive
     quietly.
   - Found by me while fixing: my new pjArchWhen replaced the archived-projects list's own pjArchWhen (a function
     declared twice; the later wins with no error). Renamed pjRoomArchWhen, and a new test asserts every top-level
     function in the page is declared once (mutation: a second pjArchWhen reds it).
3. (general-purpose, 18:3x CDT) 1 BLOCKER, 7 WARNINGs, 1 CONVENTION, 5 NITs; all applied.
   - (B) the browser check read the receipt from the body before the page wrote it (the page reads the count after
     closing the confirm, and the toast writes 60 ms late): it waits on #msg-toast's own words.
   - (W) Undo read focus after disabling the focused button (focus goes to the body; WebKit never focuses a clicked
     button): it reads focus first and passes it to pjArchClose, which also counts focus on the body as "from the header".
   - (W) a slow Archive could act on a confirm opened later for another project: a per-opening token; a closed opening's
     answer touches nothing, and the choice is locked while a request is out. Its result then shows nowhere: the person
     moved to another project, and the archive is set; noted as the weakest part of this fix.
   - (W) on a phone the archive header pushed the thread's newest rows under the composer: pjFitRoomPhone runs after
     paintArch and pjArchReset; the 390 px arm opens the archive and asserts the thread ends above the composer.
   - (W) the 390 px assertion passed when the button was not rendered: split into "no sideways scroll" and "the button
     is shown inside its header".
   - (W) the gap-block fix had no pin: the count is asserted after the LAST pjWinReset in loadRoom (mutation reds it).
   - (W) "nothing archived" compared the total against 0: pjArchOutcome compares the count before and after (receipt,
     "back in the room" for an earlier cutoff, "nothing more" for the same one), with no hole where a time is missing;
     unit test and two browser arms.
   - (W) the archive reaction fix had no test: a vm test, mutation reds it.
   - (C) the README row now lists every arm.
   - NITs: labels match their assertions (the live count is asserted); "Opening the archive..." is a flag
     pjWinOlderLine honours; the confirm is checked to paint on top (elementFromPoint at the middle and two corners);
     the CSS comment describes its rules, and the archive's bubbles are quieter by opacity, not a filter; the poll's
     no-repaint stamp includes the archive count, so an archive set elsewhere draws the boundary row.
   - Also: 3a's two room-read pin fixes (roomRows) are applied here, since this branch merges 3a.
4. (sonnet, 18:5x CDT) 0 BLOCKERs, 5 WARNINGs, 5 NITs; the WARNINGs and NITs 6 and 8 applied; NITs 7, 9, 10 answered.
   - (W) the "poll lands while the archive is open" step slept 6.5 s and never proved a poll ran: it waits until
     PJ_WIN.newest holds the new post (a CONTROL that fails on timeout), then asserts the archive is untouched.
   - (W) the 390 px section filled a search box that may be hidden at phone width: dropped (already cleared).
   - (W) openProject's close of the confirm moved focus to the new room's button, and an in-flight Archive's outcome
     was said nowhere: that close keeps focus where it is, and the answer is said by the project's name.
   - (W) a slow Undo closed an archive view opened again meanwhile: it closes only the view it was pressed in. Not
     reachable by the vm harness (the handler is a listener); the browser check's Undo step runs the normal order.
   - (W) the Undo sentence repeats the server's 30 days and 1,000: a test ties it to ARCHIVE_AGE_MS and ARCHIVE_KEEP
     (mutation: 31 days reds it).
   - NIT 6: msgToast is a polite live region, so Archive and Undo no longer also call pjRoomAnnounce (heard once).
   - NIT 8: Back marks the room seen when it is on screen.
   - NIT 7, answered: the typeof PJ_ARCH guards are for lifted tests that run loadRoom or pjRoomRow WITHOUT PJ_ARCH
     declared at all (typeof an undeclared name is 'undefined'); in the page nothing calls them before load.
   - NIT 9, left: two small reads per Archive press (n=1); the server builds the room rows for each. Not measured as
     costly; the POST answering its own count would remove both, a server change for a later slice.
   - NIT 10, answered: the archive route is an operator write that needs only the project, so a room with no agents
     archives normally; nothing ends in "could not" there.
