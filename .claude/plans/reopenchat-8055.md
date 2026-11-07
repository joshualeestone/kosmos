# reopenchat-8055: reopen the open chat after iOS ends the app; no relaunch line (kosmos#8055)

## Done when
On a real iPhone, with a chat open, iOS ending Kosmos in the background (or the app swiped away) and the app then started
again opens that same chat, on the same computer, with no "your chat had closed" line. (Card: not done at merged.)

## Why
Josh's TestFlight sighting 11-07 16:56: the diagnostic line from #8079 read "Found at 4:56 PM: your chat with Jennika had
closed: the app was started again (...)", and he read it as "kind of a weird error". That cause (ChatClose.relaunched) is a
cold start, not our screen closing the chat. Mona Lisa's call on the card: a person should not see that line; the fix is to
reopen the chat.

## Decisions
- Board.chatClosedCause(.relaunched) returns nil: no line on a cold start. The other causes (popped soon after a return,
  popped while away, lost with the tab) keep their line: those are our screen closing a chat, and a sighting of one is how
  the warm-return bug is found.
- Kept in this phone's defaults (key kosmos.openChatKept) as "<computer host>\n<agent session>\n<name>\n<seconds when kept>"
  (Board.keptChat), written when a chat opens,
  removed when it closes, on an account change (blankOpenChat) and once the Agents tab has looked.
- Reopened (Board.chatToReopen) only when the computer this launch opens on (client.macURL host) is the one it was kept
  on, and only when nothing this run has opened a chat yet (client.chatOpen nil). A notification's chat wins (the existing
  guard in findClosedChat). The agent is taken from the list if there, otherwise opened by its session, as a
  notification's chat is.
- No computer known yet at that moment: nothing reopens and the record goes, so the person gets the list (no line).
- Reopens only within 12 hours of being kept (Board.chatReopenWithin); after that the person comes back to the list.
- A reopened chat whose agent the first list read does not have (removed while away) closes quietly, back to the list.
- A reopen is written to the device log ("[Chat] the app started again with a chat open on this computer: reopened").

## Weakest premise
That client.macURL is set by the time the Agents tab's first findClosedChat runs on a cold start (admitted is restored
synchronously in start() from the saved session). If it is not, the reopen silently does nothing. Only a real-iPhone check
can show it; the sample board has no computer, so the simulator cannot.

## Tests
- ios/LogicTests/main.swift: keptChat / chatToReopen (same computer, other computer, no computer, malformed, an older
  build's bare name, line breaks), and .relaunched now nil.
- All ios/LogicTests suites pass; the app builds for the simulator.
