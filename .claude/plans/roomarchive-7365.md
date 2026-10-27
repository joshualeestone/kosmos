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
1. DONE (this branch's first commit; its PR number goes here): the room read groups reaction rows once (398 -> 31 ms at 5,500 posts).
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
1. (slice 1, default, 12:5x CDT) 0 BLOCKERs, 2 WARNINGs, 3 NITs. The reviewer's side-by-side probe (old and new route
   on one fixture with interleaved reactions, released and re-taken claims, a non-member claimant, a shared post id
   across rooms, numeric ids) gave byte-identical output.
   - (W) The test never reached claimOf: a 🙋 claim on every fifth post now makes the read ask it, and the test checks
     what claimOf is given and the claims against a whole-log replay with the route's members (mutation-proven: the
     whole log reds it with 183 rows).
   - (W, not in this slice) `unanswered` is O(asks x room) per read: 37 to 58 ms at 1,834 open asks in a 5,500-post
     room, the worst case. Noted on the card; not worth this slice.
   - NITs: the comment names rowShaped as why String() keys alike and why grouping is not by project; the docblock now
     matches the test; the plan no longer names a hash a rebase merge would orphan.
2. (slice 1, sonnet, 13:0x CDT) 0 BLOCKERs, 1 WARNING, 2 NITs, all applied.
   - (W) The claim half was still vacuous: the room had no members, so every claim was null on both sides and an empty
     claimOf passed. gamma is now a member (projects.addAgent), every fifth post must be held by gamma, and each claimOf
     call must be given the claim row (mutation-proven: an empty claimOf reds it).
   - NIT: a reaction written from another room on this room's post id is now in the fixture, so "not grouped by
     project" is tested (mutation-proven: filtering by project reds it).
   - NIT: one local `own` for both calls, and the comment says NO_REACTIONS is shared because neither callee mutates.
3. (slice 1, default, 13:0x CDT) 0 BLOCKERs, 1 WARNING, 3 NITs. The reviewer's old-against-new probe was byte-identical
   (14,489 bytes, JSON and text, claims and person's 🙋 included); 7 of 8 of its mutations red the test.
   - (W) The eighth passed: posts with NO reaction (most of a real room) could be handed the whole log again unseen.
     Ten such posts are now in the fixture; each must be handed no rows and carry no reactions field (mutation-proven:
     `|| rec.rows` reds it, "given 194 rows").
   - NITs not changed: the plan's PR placeholder is filled when the PR opens; the #6946 comment ("no second pass") is
     still true; slice 2's poll still builds every row server-side before the page cut (O(log + posts) now, measured
     31 ms at 5,500), to be measured there.

## Slice 2 review rounds
1. (default, 13:1x CDT) 1 BLOCKER, 6 WARNINGs, 3 NITs. ALL FIXED 13:1x-13:2x (commits "review 1 B1/W1/W2/W3+W4/W5/W6" and
   the NITs): B1 race test (mutation-proven), W1 browser-checked ("further back"), W2 loading/failure line + stop-on-
   failure test, W3/W4 browser-checked (no false no-match; clear paints the window in 30 ms), W5 floor measured now
   (test), W6 held row updated (test), convPause, earlier rows not stamped as speech, the reopen test's URL pin. The
   >200-new-rows reset without an anchor is left (rare: a sleeping laptop; the reader lands on the newest page).
   Detail as found:
   - (B1) pjWinEarlier sets boundary = newestOlder AFTER the await: a poll landing mid-read with new posts moves
     newestOlder, so the rows between are never read (measured: p801-p830 lost for good). Fix: take
     `const at = PJ_WIN.newestOlder` before the await with the cursor; if it moved, loadRoom() at once. Test the race
     (reviewer's probe: scratchpad/revwin1/web.review-race.test.js).
   - (W1) a reply to a post outside the window says "Original message unavailable" (web/index.html ~77407). Mirror the
     DM's "Original message is further back" (~42282) when the target is older than the oldest loaded row or
     PJ_WIN.olderCount > 0.
   - (W2) no loading sign, no failure row, no back-off (61 requests in 3 s on 503), a 400 cursor retried for ever, a
     reader at scrollTop 0 stuck after a failure. Port the DM's paintOlderLine / `because` / stop-on-failure with
     Try again (~42858).
   - (W3) starting a search repaints the windowed body first and says "Nothing here matches" aloud before the whole
     read lands. On the empty-to-searching transition, skip the cached repaint and announcement until the read lands.
   - (W4) clearing a search paints the whole 5,500-row body once (873 ms). On searching-to-empty paint the window
     (pjWinMerge(PJ_WIN.older, PJ_WIN.newest)) or nothing.
   - (W5) gap-fill anchoring reads __roomHeldAtBottom (last repaint) not the live position: measure fresh before paint
     (scrollHeight - scrollTop - clientHeight <= THREAD_BOTTOM_SLACK).
   - (W6) a reaction made on an older post is lost at the next rebuild (rxnToggle ~74409 patches only the DOM): on
     success update the row in PJ_WIN.older by id, as the DM does.
   - NITs: convPause() before painting an earlier page (the DM does); learnedAt stamps old rows as "just spoke"
     (~77703) when an earlier page lands; the >200-new-rows reset lands a scrolled-up reader on an arbitrary row;
     tests for the race, the scroll listener, search transitions, reply headers, tied keys.
2. (sonnet, 13:2x CDT) 0 BLOCKERs, 2 WARNINGs, 2 NITs + 1 low WARNING; all applied but N1.
   - (W1) the search guard's counter was reset to 0, so a second search reused the first's number and a late first
     read cleared the guard mid-second-read (a false no-match aloud). Now a ticket that only grows plus a pending
     ticket; browser-checked with the reviewer's probe (renamed copy roomprof/revwin2-race-b.js): pending stays 2,
     the mid-read keystroke is ignored, and the one announcement comes from the whole room and is true.
   - (W2) a search read that a poll took over, or that failed, still announced a no-match from the window: loadRoom
     now answers true only when it painted, and only then does the search speak (test).
   - (W3, low) a reaction updated only the earlier pages' rows: the newest page's too (test).
   - N2: pjRoomRow's PJ_WIN read is typeof-guarded like paintRoom's. N1 (the >200 reset) left, as recorded.
3. (default, 13:4x CDT) 0 BLOCKERs, 3 WARNINGs, 5 NITs; all WARNINGs and NITs 1, 3, 4 applied.
   - (W1) a room too short to scroll (a folded run of refusals; reviewer measured 500 posts behind one band) never read
     its earlier pages: pjWinNearTop runs after every paint, as the DM thread does; a hidden box asks nothing (test,
     mutation-proven, with the hidden-box control).
   - (W2) Try again by keyboard dropped focus to the body: focus moves to #pj-post first, as the DM's does.
   - (W3) a reader who scrolled far back kept every held row repainting each poll (600 ms at 5,500 held): back on the
     newest message the earlier pages are let go (pjWinLetGoOfEarlier), and scrolling back reads them again from the
     newest page's own cursor (test, mutation-proven: the stale cursor reds it).
   - N1: a search started before the room's first read still reads. N3: my insert had split rxnFreeClaim's if/else
     (the button stayed disabled on a refusal): restored, the note after it. N4: the earlier-pages line hides while a
     search is on. N5 (a cleared search briefly shows the pre-search window, then rereads) and N2 (a 503 page read draws
     nothing where the whole read drew an ok:false body) left as recorded.
   - Untested by a lifted test, browser-checked instead: the search handler's ticket sequence (revwin2-race-b.js),
     the line and Try again, the "further back" header (revwin1-probe.js).
4. (sonnet, 13:5x CDT) 0 BLOCKERs, 1 WARNING, 1 NIT; both applied.
   - (W) on a room the newest page alone cannot fill, pjWinNearTop read an earlier page, the paint's own scroll event
     let it go, and that repeated every poll (reviewer measured, revwin4-tall.js). Now only pages the READER scrolled
     back to (byReader) are let go, and a scroll within 500 ms of the page's own paint is not the reader reaching the
     bottom. Browser: the tall room reads one earlier page and keeps it, polls read only the newest page (test,
     mutation-proven: letting go of any page reds it).
   - NIT: letting go draws the newest page at once, so screen and state never disagree before the next poll.
5. (default, 14:0x CDT) 1 BLOCKER, 2 WARNINGs, 4 NITs; the BLOCKER, both WARNINGs and NITs 1, 2 applied.
   - (B) a reader scrolled up inside the newest page slid one message forward per new post (the window dropped rows
     from its top under a pixel restore; reviewer measured p900 -> p921 after 20 posts, control on the base held).
     While the reader is off the newest row the rows pushed out are kept (held for the reader), and every off-floor
     paint anchors. Browser (revwin5-slide.js): p900 stays at y=-118 with 20 rows kept. Test, mutation-proven.
   - (W1) a reader already on the newest row fires no scroll, so ~1 in 10 returns kept every page: loadRoom lets go
     after its own paint when the reader is on the newest row, and paintedAt is set after the paint. Browser
     (revwin5-guard.js): let go within two polls of a 100 ms return.
   - (W2) letting go during a gap read left rows held for ever, growing per post: a let-go counter the gap read checks
     after its await, and pages a room read for itself are trimmed from the front by the gap. Browser
     (revwin5-gaplet.js): nothing held, nothing grows over 3 x 150 posts. Test, mutation-proven.
   - N1: speech stamping skips every row older than the newest page by time (a search's rows carry no key). N2: at most
     two self-started earlier reads in a row (PJ_WIN_SELF_READS). N3 (named scroll listener for lifted tests) and N4
     (document guards) left; pjWinNearTop got a typeof document guard.
