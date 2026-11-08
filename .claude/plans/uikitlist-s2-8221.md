# kosmos#8221 slice 2: New messages capsule, search, keyboard dismissal on the UIKit list

Stacked on slice 1 (#8237, merged 11-08 03:13 CST as 61e0cac90c). Debug only: a release build still draws the lazy list.

## Finished looks like
Items 5, 7 and 8 of the card's list each have a UI check that runs on both lists (UIKitListArm) and passes on the UIKit
list, with the UIKit arm shown able to fail by a perturbation. Where a check cannot be made able to fail on
the simulator, that is written down instead of shipping the check. Nothing here is run by CI: ios/tools/ui-sample.sh runs a
fixed class list without these, and nothing runs the UIKit arm. Every result below is a hand run on one simulator.
Before adding them to that list: it already runs two classes on the 260-message chat (KeyboardSlideUITests, EndPullUITests)
but leaves ChatOpensAtNewestUITests out because its queries over that chat were too big for a CI runner. These checks query
only the few "New message" rows and single labels, which is not measured on a CI runner.

## What changed
- ChatList: a Debug-only `sampleUp` / `sampleRested` pair. KOSMOS_SAMPLE_SCROLLUP=<n> puts the n-th row from the end at
  the top 3 s after the list is made (once a launch, once it has scrolled) and sets atEnd false itself (it skips the scroll delegate), then shows the same
  `sample-scroll-rested` marker the lazy list does. ChatView passes nil and an empty closure in a release build.
- ChatView.conversationUIKit: computes that row and draws the marker.
- NewMessagesUITests (item 5): a reader higher up (by the hook, and by a real drag) gets the capsule as messages arrive
  (KOSMOS_SAMPLE_GROW); pressing it takes them to the newest and the next arrival shows with no capsule. Control: a
  reader at the newest never gets it, looked at after every arrival and polled 6 s more. While the capsule shows, an older
  message is on screen and Message 260 and the newest arrival are not; after the press, that older message is not.
- ChatSearchUITests (item 7): matches only, newest match on screen, the no-match line, clearing brings the chat back at
  the newest.
- ChatDragUITests (item 8): a drag down takes the keyboard down and leaves messages drawn above the box.

## Measured (iPhone 17 Pro Max, iOS 26.5, one simulator, 11-08)
| check | UIKit | lazy | shown able to fail (UIKit arm only) |
|---|---|---|---|
| capsule, hook scroll-up | 6 of 6 | 6 of 6 | red with unseenNew never set on a new message |
| capsule, real drag up | 4 of 4 | 4 of 4 | red with endSlack 100000 (the list read the drag as at the end and pinned the reader back) |
| capsule control, at the newest | 6 of 6 | 6 of 6 | (control) |
| search | 5 of 5 | **4 of 7** | red with Board.chatFilter ignoring the query ("Message 260 still drawn") |
| drag down dismisses | 5 of 5 | 6 of 6 | red with keyboardDismissMode .none |

Not shown able to fail on the lazy arm: none of these was perturbed there.

**The lazy search failures are the lazy list, not the check.** All three recordings end on the search field reading
"Message 15", ten loaded matches, and an empty message area: the lazy list drew nothing. Its blank recovery is off while
searching (Board.listBlank's `searching`), so nothing rebuilt it. The UIKit list never blanked. Recorded on #8221 as more
evidence for the new list; no separate card, since the fix for this class is the list replacement itself.

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
