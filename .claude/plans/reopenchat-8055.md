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
- Kept in this phone's defaults (key kosmos.openChatKept) as "<computer host>\n<agent session>\n<name>\n<seconds when first opened>\n<account fingerprint>"
  (Board.keptChat), written when a chat opens,
  removed when it closes, on an account change (blankOpenChat) and once the Agents tab has looked.
- Reopened (Board.chatReopen, through Board.launchChat) only when the computer this launch opens on (client.macURL host) is the one it was kept
  on, and only when nothing this run has opened a chat yet (client.chatOpen nil). A notification's chat wins (the existing
  guard in findClosedChat). The agent is taken from the list if there, otherwise opened by its session, as a
  notification's chat is.
- No computer known yet at that moment: nothing reopens and the record goes, so the person gets the list (no line).
- Reopens only within 12 hours of the chat first being opened (Board.chatReopenWithin); a reopen keeps that first time, so
  the window does not restart on each launch.
- Same account only: the record carries BoardClient.keptChatOwner, a hash of the session's fingerprint with the
  computer's address (never the fingerprint itself, which stays out of plain app storage), compared on the launch.
- A cold launch a room or board-page notification takes counts as the launch (ContentView sets launchReopenLooked), so
  a later first visit to Agents does not reopen an old chat.
- Only on a launch: the Agents tab's first look under this client (BoardClient.launchReopenLooked; a new scene makes a new
  client), and only when the app starts on the Agents tab (AppTabs.todayTab off, as in production). A later first visit,
  as from Today, never reopens a chat by itself. No time window: a slow Face ID unlock does not lose the reopen.
- A launch a notification is still opening drops the kept chat, so it does not reopen later by itself; one already open has
  written its own record.
- A kept chat that is not reopened says why in the device log (no computer yet, another computer or account, too old).
- A chat opened while no computer is reached yet is not kept (nothing to tie it to): a known gap, it reopens to the list.
- A reopened chat whose agent the first completed list read this run (client.fresh) does not have, an empty list
  included, or whose list is another computer's, closes quietly, back to the list, with a device-log line.
- A reopen is written to the device log ("[Chat] the app started again with a chat open on this computer: reopened").

- The launch decision and the quiet close are pure functions (Board.launchChat, Board.reopenedChatStays), tested in
  ios/LogicTests; the view only applies their answer. A quiet close removes the kept record itself.
- A reopened chat on a computer that never answers stays open on a placeholder agent until a list read
  comes in: accepted, the same as a notification's chat. Not measured: what the chat shows meanwhile.

- A chat the screen closed while the app was away (chatClosedAway) keeps its record, so if iOS then ends the app, the
  next launch reopens it: the person had it open and did not close it. Deliberate.
- Every notification route marks the launch as used before routing (openAgentChat, openRoom, a board page), so the
  Agents tab's first look cannot reopen an old chat under what the notification opened.
- Any first look that cannot reopen (no computer yet, signed out) uses up the launch and drops the record: known gap,
  and the reason the card is not done until a real iPhone shows a reopen.

## Weakest premise
That client.macURL is set by the time the Agents tab's first findClosedChat runs on a cold start (admitted is restored
synchronously in start() from the saved session). If it is not, the reopen silently does nothing. Only a real-iPhone check
can show it; the sample board has no computer, so the simulator cannot.

## Tests
- ios/LogicTests/main.swift: keptChat / chatReopen / keptOpenedAt / launchChat / reopenedChatStays (same computer, other computer, no computer, malformed, an older
  build's bare name, line breaks), and .relaunched now nil.
- All ios/LogicTests suites pass; the app builds for the simulator.
