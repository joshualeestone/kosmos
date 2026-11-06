# pulldots-8078: pull to refresh with the simple dots (kosmos#8078)

Josh, 2026-11-05 18:33 CST: "only use the dots spinner in the mobile app and scrub any other instances". iOS's own pull to refresh always draws iOS's spinner and cannot be given another view.

## What
- `PullRefreshLogic.swift`: the decisions, with no UIKit, tested by `LogicTests/run-pullrefresh.sh`.
- `DotsRefresh.swift`: `DotsRefreshDriver` watches a real `UIScrollView`, so one piece serves a SwiftUI list and the board page's web view. `.dotsRefresh { ... }` takes the refresh as a closure and finds the list's scroll view.
- The 10 lists and the board page use it. The sweep guard's pin goes to 0 and is a hard fail.
- Not wired into ChatView or RoomView, by Angel's word: pulling past a chat's end is the state the #7420 blank fixes act on (#8072). The guard holds that.

## Decided
- Rejected an overlay: a list's top moves with a large title and differs per screen. A subview of the scroll view is placed as iOS places its own.
- The dots exist only during a pull or a refresh, so a resting list has no clock-drawn view (#7427's concern).
- The space is held for at most 20 s, so a person offline gets the list back while the work goes on.
- The board page holds no space and never writes the web view's insets, since WebKit manages them. The dots rest over the top of the page until it has loaded.
- VoiceOver gets a named Refresh action, which says so when it starts.

## Weakest premise
Finding the scroll view by walking the view tree: there is no API before iOS 18, and an iOS update could change the tree. A list that is not found has no pull at all, and one found wrongly would pull the wrong list, which review 3 raised for a pushed screen: the first look now waits a turn and takes the nearest visible one; the UI tests catch it on the tabs they drive, and they are run by hand: no workflow runs UI tests.

## Not measured
A real iPhone (the card's Done). Whether VoiceOver can reach the named action on a list or on the board page, and iOS's own three-finger scroll to refresh, which may be lost: a real device with VoiceOver has to say. The board page's pull, Today, a task's page, a project's info, an agent's info and Files have no UI test; they use the same piece.
