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
- ios/tools/ui-sample.sh: the new class, 3 tests, in the CI run's class list and header (--help range bumped to 2,13
  for the extra header line). .github/workflows/ios.yml: the ui job's comment names what it now guards.

## Verified
- iOS 26.5: RoomOpensAtNewest 150, 220 and 220-again PASS with the change; CONTROL (goEnd's retries removed) all three
  FAIL (the reopen check at its first open). Reopen-only control (retries kept on first open): all PASS, see above.
- Screenshots: 150 and 220 open on their newest with the change.

## Known trade-off
A person who flicks up within half a second of opening a long room is pulled back to the end. The thread's onAppear also
runs on coming back from a member's chat or another tab: it jumped to the end before this branch, and now repeats that
jump for half a second.

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
