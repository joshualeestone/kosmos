# uikitlist-8221: spike, a UIKit message list against the #7420 blank

Experiment branch, never merged (built on tailcap-7420, the box-flip recipe on main @ a91e212a0f).

## Question
Does a UIKit list (UICollectionView, self-sizing cells hosting the existing SwiftUI rows via UIHostingConfiguration)
go blank when the list shrinks at the newest message, where the SwiftUI LazyVStack does (#7420)?

## Finished looks like
A count from the simulator recipe, both arms, read against a stop rule written here before the runs, posted on #8221.

## Build (Debug only, KOSMOS_SAMPLE_UIKITLIST=1)
- ChatView.conversation: when the switch is on, the ScrollView/LazyVStack is replaced by UIKitChatList, a
  UIViewRepresentable around a UICollectionView (list layout, estimated heights, self-sizing cells), one cell per
  ChatItem, content = row(item). Kept at the newest: after any bounds change or new items while it was at the bottom,
  scroll to the last item.
- No keyboard hold, no earlier-page loading, no rebuild machinery in that arm: the spike measures drawing only.
- Blank metric, both arms, from the trace every 0.2 s from 5 s to 38 s: rows on screen (control: onScreen.count;
  UIKit: visible cells whose frame meets the visible bounds). Test sleeps 40 s so the samples run.

## Count and stop rule
- 15 runs per arm, alternating, a fresh simulator per run, iPhone 17 Pro Max, iOS 26.5.
- A run is blank if any sample after the first flip shows 0 rows on screen (control also: a rebuild in the trace).
- Read at 30. UIKit 0 blank and control >= 2 blank: worth a plan to switch. Both blank: close #8221 with that result.
  Control 0 blank: the recipe did not reproduce in this batch; say so, no conclusion.

## Weakest premise
The control blanks only from one opening state (1 of 10 on 11-07), so 15 runs may show few control blanks.
