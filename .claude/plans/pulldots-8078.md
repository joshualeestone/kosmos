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
- VoiceOver gets a named Refresh action, where a pull is not available.

## Weakest premise
Finding the scroll view by walking the view tree: there is no API before iOS 18, and an iOS update could change the tree. A list that is not found has no pull at all and draws nothing wrong; the UI tests catch it on the tabs they drive.

## Not measured
A real iPhone (the card's Done). The board page's pull, Today, a task's page, a project's info, an agent's info and Files have no UI test; they use the same piece.
