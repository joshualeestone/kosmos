# roomopen-7654: a long room opens on its newest post on iOS 26 (part 1 of #7654)

Card: kosmos#7654 (found while building #7645, claimed by Angel 10-30). Stacked on roomkb-7645 (#7645's room debug
hooks: KOSMOS_SAMPLE_ROOM_LONG=<n>, ROOM_SCROLLUP, ROOM_FOCUS), which is stacked on uitrace-7609 (PR #7632).

## Finished looks like
On iOS 26.5 a 150- and a 220-post room open with the newest post on screen above the box, measured by a UI test that
fails without the change. 50- and 100-post rooms and iOS 27 opened there before the change (screenshots, 10-30); no
test covers them, because the change only repeats a jump that already landed for them. The checks that fail without
the change use a Debug-only setup (150 or more posts arriving at once); the path a real person meets (a long room
reopened after new posts arrived) is reasoned, not measured.

## Measured before the change (iOS 26.5 simulator, 8 s after opening, no other hooks)
- 50 posts (a real room's first page, RoomStore.pageSize): Post 50. 100: Post 100. 150: half a post short. 220: Posts
  212 to 216, four short, and it stays there. iOS 27.0, same build, 220: Post 220.
- So a real first open (50 posts) is fine. Measured short: posts arriving while the room opens, more than ~100 of them.
  Reasoned real case (not measured): reopening a long room read back through while new posts arrived, which sends the
  jump through the first-page path. (Reviews 5 to 7: the retries used to be gated on atBottom, which can still hold its
  starting true there; review 7 removed the gate, see Change.)
- Cause: RoomView jumps once (proxy.scrollTo("bottom")) in a LazyVStack whose rows above are estimated; the DM's #7265.

## Change
(Round 3 changed the retry schedule and added the person's cancel: see "Round 3" at the end.)
- ios/Kosmos/RoomView.swift: goEnd(proxy) replaces the single jump on the two opening paths (the first page in
  onChange(of: rows.last?.id), and the thread's onAppear for a room opened again). It jumps, then retries at 0.05, 0.15,
  0.3 and 0.5 s while the room is visible, not searching and not in the archive (review 7: not gated on atBottom, which
  starts true before the end marker is drawn; a jump to the end already there does nothing). endJumps: a newer goEnd,
  a reply jump, or loadOlder (at its start) cancels an older one's retries. The other jumps (new post, pending post,
  search cleared, archive) are untouched.
- ios/KosmosUITests/RoomOpensAtNewestUITests.swift: 150 and 220 posts open on the newest, above the box, and 220 opened
  AGAIN (Back, then the row). Presence first (some post of the room is drawn), then the newest. The reopen check is a
  guard on reopening, NOT proof of goEnd there: a control with the retries removed only from the onAppear path passes it
  (a reopened room appears with its posts already loaded, and its single jump lands at 220 posts on iOS 26.5). The box
  is pinned by app.textFields and its placeholder.
- ios/tools/ui-sample.sh: the new class, 4 tests since round 3, in the CI run's class list and header (--help range bumped to 2,13
  for the extra header line). .github/workflows/ios.yml: the ui job's comment names what it now guards.

## Verified
- iOS 26.5: RoomOpensAtNewest 150, 220 and 220-again PASS with the change; CONTROL (goEnd's retries removed) all three
  FAIL (the reopen check at its first open). Reopen-only control (retries kept on first open): all PASS, see above.
- Screenshots: 150 and 220 open on their newest with the change.

## Known trade-off
For a moment after a long room opens (and when it shows again, coming back from a member's chat or another tab, where
main made one jump), the room keeps going back to its newest post: up to 2.3 s on iOS 18 and later, 0.5 s below. On 18 and
later the person's scroll ends that (PersonScroll: tracking, interacting or decelerating), and a person already scrolling
when it starts gets only the one jump; a tap, a long-press, a status-bar tap to the top (animating phase) and, probably, a
VoiceOver scroll (not measured) do not end it. Below 18 nothing ends it early: a flick within half a second is pulled back.

## Not this branch (part 2 of #7654)
A person's own scroll to the end of a long room stops short on iOS 26 (six swipes: 212 to 218 of 220, with and
without this change). Approach to measure: eager newest rows (the DM's iOS 16 path) or an id anchor (iOS 17+).
#7645's testRoomNewestStaysAboveTheBox is its failing test and is NOT in ui-sample's list until then. It carries
XCTExpectFailure (strict: false), so it reads green while it still fails: its log says "Expected failure in", and
xcodebuild's "0 failures" summary does not count that. Part 2 removes the XCTExpectFailure to use it as the test.

## Known limits (review round 1)
- CI is evidence only on iOS 26: iOS 27 lands without the change. #7632's CI ui run resolved to iOS 26.5; confirm this
  PR's run prints "on iOS-26-5" (ui-sample's device line) before reading its green as proof.
- ChatOpensAtNewestUITests is out of this CI run because its 260-message chat timed out XCTest's UI query on CI. The
  220-post room uses the same kind of query; only a CI run shows whether it holds there.

## Weakest premise
That 0.5 s of retries and the 220-post query both hold on a slower CI runner. If either flakes, widen endRetries, or drop
the room to 150 posts in CI.

## Round 3 (01:0x CDT 10-31): CI's runner (run 41156064258) stopped the 220-post room short
Measured: the 150-post check passed on CI; both 220-post checks failed ("did not open on its newest post"); local iOS 26.5
passes all three. #7645 showed the cause on the same runner: rows above are measured again for well over half a second
there (will-show to did-show took 1.3 s), so goEnd's last retry at 0.5 s landed before the room's height settled.
Change: PersonScroll (the DM's iOS 18+ scroll-phase reader) on the room's list; the person's first touch bumps endJumps,
cancelling every pending retry. Where that cancel exists (iOS 18 and later, ChatView.followsScrollPhase) the retries run to
2.3 s (0.05, 0.15, 0.3, 0.5, 0.8, 1.2, 1.7, 2.3); below it they stop at 0.5 s (main made one jump: on iOS 16 and 17 this adds a half-second window with no cancel).
Rejected: retrying until the end marker shows (it can show while rows above are still being measured, then move away).
Weakest premise: that 2.3 s covers CI's runner. If the 220 checks still fail, the record of when the end marker last moved
is the next thing to add.
Round 3 review 1: the Debug scroll-up hook (KOSMOS_SAMPLE_ROOM_SCROLLUP, 3 s after opening) now ends the retries as a
person's scroll would (a programmatic scroll reports no scroll phase), and no retry lands while the person is already
scrolling (`!roomScrolling`, for a goEnd that began mid-scroll). New check: testRoomOf220ScrolledUpAtOnceIsNotPulledBack
(superseded below: the retries stretched ten times, the swipe bounded, a 24 s wait); ui-sample's class count is
4. Results: below (ui-sample picks the newest runtime, iOS 27, where the opening jump already lands; the room checks are
run on the iOS 26.5 simulator by hand, both arms).
Round 3 results (iOS 26.5 simulator kbexp17e, by hand; iOS 27 by ui-sample):
- ios/tools/ui-sample.sh (iOS 27.0, fresh iPhone 17e): 14 of 14 on 579589a691.
- RoomOpensAtNewestUITests on iOS 26.5: 150, 220 and 220-again PASS (987ae2ea89).
- The cancel check, both arms, on 2639670142: with the change PASS; CONTROL (the person's cancel removed) FAILS ("the room
  pulled the reader back to its newest post after their own scroll"). Two earlier versions of the check could not fail: the
  first swiped a post laid out off the screen, the second swiped after the real 2.3 s retries had ended (XCUITest finds the
  list too late). It now stretches the retries five times (KOSMOS_SAMPLE_ROOM_RETRYSCALE, Debug only).
- LogicTests run.sh 1723/1723, run-room.sh 741/741.
Round 3 review 2: `roomScrolling` is cleared when the room goes off screen (its idle phase may never come across a push);
the cancel check skips below iOS 18 (no scroll phase there). A full ui-sample run on the final commit is recorded in the PR.
Round 3 review 3: the cancel check stretches the retries ten times (last at 23 s) and skips, saying why, if its swipe would
start more than 18 s after launch (it would then test nothing). ui-sample counts a skipped check as run and names the
skips in its PASS line ("N of them SKIPPED: a skip tested nothing"). Trade-off adds the status-bar tap (animating phase).
Round 3 review 4: on GitHub Actions a skipped UI check is also a ::warning:: annotation on the run, so a green job that
tested less shows it; the cancel check is best-effort on a slow runner (it skips if its swipe would start after 18 s).
Reasoned, not measured: loadOlder (which cancels the opening retries) runs from the settled-at-bottom path only while the
top's older-posts line shows, i.e. the whole loaded page is on screen, where no retry is needed; a long real room (older
pages, its top off screen) keeps its retries. The sample room has no older pages, so no check covers that interaction.
Round 3 review 5: goEnd schedules no retries when the person is already scrolling (only the one jump, as on main); the
archive showing ends the retries (endJumps); the expected-failure marker in RoomKeyboardUITests matches only its two known
part-2 messages, so any other failure there shows; the claim that iOS 16 and 17 behave "as before" was against round 1, not
main (main made one jump; this adds a half-second window there), corrected in the code and here.
Both arms on the current cancel check (ten-times stretch, 18 s guard, 24 s wait), commit 5190cba0fd, iOS 26.5: with the
change PASS; CONTROL (cancel removed) FAILS "the room pulled the reader back to its newest post after their own scroll".
Round 3 arms on the final code (a3b1bbb222, iOS 26.5): with the change, RoomOpensAtNewest 4 of 4 PASS; CONTROL (cancel
removed) 3 PASS and the cancel check FAILS. RoomKeyboardUITests' known part-2 failure also surfaced as a failed lookup of
Post 220 inside a helper (not one of the two matched messages), so the matcher includes that lookup too.
