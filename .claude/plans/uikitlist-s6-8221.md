# uikitlist-s6-8221: count UIKit-list chat opens on their own (kosmos#8221, slice 6)

Stacked on uikitlist-s5-8221 (the Settings switch). Rebase onto main as slices 4 and 5 merge.

## Finished looks like

A phone with the New chat list switch on sends its chat opens to the board again, marked as the UIKit list's, and the board
keeps them apart from the lazy list's under the same build. GET /api/phone/chat-opens shows, per build, the lazy counts
exactly as before plus a `uikit` block with the same four numbers, so Josh's phone's counts can be compared per list. A
measured simulator run shows a UIKit open with rows on screen is not counted blank, and one forced blank is.

## Decided

- The phone sends `list: "uikit"` on a UIKit showing and nothing new on a lazy one. Rejected: sending `list: "lazy"` too.
  An older build's records then look exactly like a lazy build's, and the board needs no rule for "absent". Weakest
  premise: that no third list ever comes; the field takes one more word if it does.
- The board keeps a build's existing four numbers for the lazy list (and every older record), and the UIKit list's in
  `builds[app].uikit` with the same four fields. Rejected: a separate top-level key per list ("<app> uikit"), which would
  break VERSION_RE, the 30-build cap's meaning, and every reader of the file. Weakest premise: that nothing else reads the
  file's top-level counts expecting every showing; grep says only the GET route and the test.
- engine/chatopens.js refuses a `list` it does not know (only "uikit" is accepted), as it refuses any other malformed field.
- The NOTE and the doc lose slice 5's "not counted" sentence and say the uikit block is counted apart.
- Before the guard comes out, measure that a UIKit showing's rows report through row() in reused hosted cells: the slice-5
  review found the handlers run there, but nothing has checked reuse (a cell scrolled away and back, a cell reconfigured on
  an update). If they do not report faithfully, this slice fixes that in ChatList (the list's own visible-cells count feeds
  openCount.rows) before sending anything.

## Steps

1. Measure on the simulator (Debug trace, KOSMOS_SAMPLE_TRACE): a UIKit open of Dana's long chat, scroll up 3 pages and
   back, type 20 keys, close after 10 s. Trace onScreen's count at close and openCount's closedBlank. Control: the same on
   the lazy list. Record both in this plan.
2. If step 1 is faithful: remove slice 5's guard in sendOpenCount and add `"list": "uikit"` to the body when uikitList.
   If not: drive openCount.rows from ChatList's visible cells on the UIKit list, then the same.
3. engine/chatopens.js: clean() accepts an optional list ("uikit" only), add() counts it under builds[app].uikit,
   cleanBuild() keeps a well-formed uikit block and drops a malformed one. NOTE and doc updated.
4. server.chatopens-7420.test.js: a uikit record counts apart; a lazy record is unchanged; an unknown list is refused; an old
   file with no uikit block still reads; a malformed uikit block is dropped, not the build.
5. Room suite: the body carries the list word only on the UIKit arm; slice 5's guard is gone.
6. All ios/LogicTests/run-*.sh, node --test server.ios-routes-6838.test.js and server.chatopens-7420.test.js, ui-sample.sh
   both arms.
7. Review loop, PR, TestFlight once slices 4 to 6 are on main; tell Josh in one line what the switch now feeds.

## Status

- [ ] Plan only (14:5x CST 11-08).
- [x] Steps 3 and 4, the board side (19:35 CST 11-08): engine/chatopens.js counts a showing with list "uikit" in its
      build's uikit block, refuses any other list, and drops a malformed uikit block on read without the build. Three new
      tests in server.chatopens-7420.test.js: 8 of 8 pass; CONTROL, the same tests with the engine change stashed, 3 fail.
      Only server.js and that test read the counts (grep).
- [x] Step 1, measured 20:00-20:03 CST 11-08, iPhone 17e iOS 26.5, Debug, Dana's long chat (KOSMOS_SAMPLE_LONG) on the
      UIKit list, KOSMOS_SAMPLE_SCROLLUP=60 (a jump of 60 rows up the thread, cells reused) then SCROLLBY=-2500 (an animated
      scroll back down). A throwaway probe, not committed, compared once a second the rows row() said were on screen
      (onScreen) with the list's own visible cells: 15 readings across both moves, every one equal (9 then 11 rows;
      said-not-shown 0, shown-not-said 0). CONTROL, same run with a third of the rows' onAppear skipped: shown-not-said
      3, 5, then 2, and said-not-shown still 0, so the probe can see a row that does not report, and a reused cell's
      onDisappear does take its old row out. Faithful: step 2 takes the plain path (remove the guard, send the list
      word); ChatList needs no row count of its own. Not measured: a cell reconfigured on an update (apply) while on
      screen; the same handlers run there, and step 6's ui-sample runs cover sends.
- [ ] Steps 2 and 5 (the phone sends the list word), then 6 and 7.
