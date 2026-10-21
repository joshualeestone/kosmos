# otherpc-6850: "Choose another computer" when the picked Mac is not answering (kosmos#6850, iOS piece)

## Finished looks like
In the iPhone app, when the computer the person picked does not answer, the "Your Mac isn't answering" page
offers, between Try again and Back to Kosmos, a button **Choose another computer**. It opens
login.kosmosplus.com/account in the app, where each computer shows its name, whether it is answering, and Open
(kosmos-relay macopen-6850). No other failure (offline, Kosmos+ not answering, anything else) shows it.

## Decided (call on #6850, comments 6323636304, 6323651418, 6324054685)
- **Target /account, not "/".** "/" opens a lone computer by itself right after an allow (arrived(), signin.html),
  which could land back on the Mac that just failed; /account never opens anything by itself (kosmos#5397).
- **Only for .macUnreachable** (Shell.offersOtherComputer). Offline or Kosmos+ down would fail the same way on any
  computer; "other" is not a computer's fault.
- **A third control, outlined, not filled**: Try again stays the primary action (the Mac may just be waking).
- **A counter like Back** (otherComputerCount), the pattern this file already uses, so a SwiftUI update cannot
  load it twice.
- Rejected: a native list of computers (a second signed read of the same facts), and showing the button only
  with two or more computers (the app does not know the count; /account answers it, and one computer is rare
  on this screen).

## Steps
1. ShellLogic: offersOtherComputer(_:), otherComputerURL(coordinator:). LogicTests for both.
2. ShellViews: ShellState.otherComputer() + otherComputerCount; LoadFailureView's optional onOtherComputer button.
3. ContentView: pass the counter; updateUIView loads otherComputerURL(KosmosConfig.coordinatorOrigin).

## Weakest premise
That /account, loaded in the app's WebView, keeps the person signed in. CHECKED 14:08: signin.html restore()
reads localStorage kosmos_session on every path but /account/delete, and /account is the same origin as "/", so
it does. Left: the relay page change being served before this reaches a phone (see Validation).

## Validation
ios/LogicTests/run.sh; an iOS simulator build of the Kosmos target (the SwiftUI is not in LogicTests).
Order of shipping: the relay page change should be served before this reaches a phone, else /account lists
computers without Open (still the answer to "which is answering", one tap short).
