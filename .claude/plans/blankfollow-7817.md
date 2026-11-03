# blankfollow-7817: the box-growth follow is off in release builds

## Finished looks like
A release build (TestFlight build 30) never runs the #7828 follow ("box height changed, to the newest"), with the
keyboard up or down, so the box growing a line is no longer one of the ways a long chat ends up past every drawn row.
It does not remove the keyboard-shown path (see Weakest premise). The two UI checks that guard the follow still run it
(Debug switch), and a source check fails if release turns it on.

## What it costs
Build 30 brings back what Josh reported on 11-02 for #7817: as a long message wraps, the conversation behind the box
moves (the newest message can end up behind the box). #7817 stays open for that; this is a mitigation, not its fix.

## Why
Josh's phone, build 29, 11-03 04:12 (keyboard up) and 04:16 (keyboard down): each blank followed "box height
changed, to the newest". The follow is `proxy.scrollTo("end")` + `positionId = "end"`; with the lazy list's content
estimated at 124690 pt against 19498 rebuilt, it lands past every row (the #7420 blank). At 04:16 the rebuild then
recovered 0 rows. A blank list is worse than the jump #7828 fixed.

## Change
- ChatView.followsBox: false in release; Debug reads KOSMOS_SAMPLE_BOXFOLLOW=1. First condition of the one
  stripHeight handler, which does not look at the keyboard, so both blanks' path is covered.
- KeyboardSlideUITests: the grow test and the reader-higher-up test launch with KOSMOS_SAMPLE_BOXFOLLOW=1.
- A release build still records "box height changed, not followed" in the chat diagnostic's events, so a build 30
  report of the jump can be tied to the box growing.
- LogicTests room: two source checks (release value false; the guard asks followsBox first), each red on its mutant.

## Rejected
- Anchor-only follow (goNewest through nil, no proxy.scrollTo), skipped while content height disagrees with drawn
  rows: unmeasured, the simulator has never reproduced the blank, and the anchor write itself may overshoot. Not
  safe to ship on reasoning alone (the plan on #7817 said gate off in that case).
- Removing the follow code: it is the starting point for the real fix.

## Weakest premise
That the follow is the only new trigger. The keyboardDidShow scroll (pre-#7828) still does proxy.scrollTo("end") and
can still blank a long chat once per keyboard show, as before build 29. The 6x estimate itself is #7420, next.

## Verify
iOS LogicTests all suites green (room 757/757, run.sh 1871/1871); swiftc typecheck Release and Debug rc=0; mutants
red; CI ui job runs the 9 KeyboardSlideUITests.

## When the follow comes back
No UI check covers "messages still drawn while the box grows with the follow on" on a long chat (the arm that blanked
on the phone): testComposerGrowingKeepsMessagesDrawn now runs with it off. Whoever turns it back on adds that arm.
