# kosmos#8221 slice 2: New messages capsule, search, keyboard dismissal on the UIKit list

Stacked on slice 1 (#8237, merged 11-08 03:13 CST as 61e0cac90c). Debug only: a release build still draws the lazy list.

## Finished looks like
Items 5, 7 and 8 of the card's list each have a UI check that runs on both lists (UIKitListArm), passes on both, and has
been shown able to fail. Where a check cannot be made able to fail on the simulator, that is written down instead of
shipping the check.

## What changed
- ChatList: a Debug-only `sampleUp` / `sampleRested` pair. KOSMOS_SAMPLE_SCROLLUP=<n> puts the n-th row from the end at
  the top 3 s after the list is made, counts as the person's own scroll (atEnd false), and shows the same
  `sample-scroll-rested` marker the lazy list does. Nil in a release build.
- ChatView.conversationUIKit: computes that row and draws the marker.
- NewMessagesUITests (item 5): a reader higher up gets the capsule as messages arrive (KOSMOS_SAMPLE_GROW); pressing it
  takes them to the newest and the next arrival shows with no capsule. Control: a reader at the newest never gets it.
- ChatSearchUITests (item 7): matches only, newest match on screen, the no-match line, clearing brings the chat back at
  the newest.
- ChatDragUITests (item 8): a drag down takes the keyboard down and leaves messages drawn above the box.

## Measured (iPhone 17 Pro Max, iOS 26.5, one simulator, 11-08)
| check | UIKit | lazy | able to fail |
|---|---|---|---|
| capsule, reader higher up | pass | pass | red with the UIKit capsule trigger broken (unseenNew never set) |
| capsule control, at the newest | pass | pass | (control) |
| search | pass | pass | asserts the dangerous cases directly (a non-match still drawn) |
| drag down dismisses | pass | pass | red with keyboardDismissMode .none on the UIKit list |

## Decided
- **The side lock gets no check.** A sideways-swipe check passed on the lazy list with its lock off
  (TEST_RUNNER_KOSMOS_SAMPLE_NOLOCK=1), so on the simulator it cannot fail. Dropped rather than kept as coverage. The lock
  stays on the lazy list; the UIKit list is a list layout as wide as itself with alwaysBounceHorizontal off.
  Weakest premise: that the phone's drift (#7420) cannot happen in a UICollectionView list layout. Not measured.
- A rightward swipe is iOS 26's back gesture anywhere on the screen; a check must not use it inside a chat.
- A drag down the chat also scrolls it to older messages, so the dismissal check asserts messages drawn, not the newest.

## Not in this slice
- A reader higher up keeping their exact place as rows come and go above (slice 3). The capsule check only asserts the
  arrivals stay off screen until it is pressed.
- Earlier pages (slice 4). Still owed from slice 1: a runner for the UIKit arm, the keystroke cost, RowTop in hosted cells.
