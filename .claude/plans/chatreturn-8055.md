# chatreturn-8055: say why a chat closed on its own

Josh 11-05 (real iPhone, build 50): back from another app, the chat shows for a second, then the agents list. Often.

## What is known (measured on a simulator, 11-05)

- The sample board keeps the chat open after 3 s and 40 s away: the views alone do not drop it.
- A real test-account sign-in with no computer: a 5 s return fires no account change and no forget.
- Not reproducible here: that account has no computer, so the board's page never loads.

## Paths that can close an open chat (read from the code)

1. `chatEpoch` changes (`BoardClient.forgetChats`): an account change from the sign-in page or this iPhone's
   sign-in (`PushNotificationManager.take`), a session that changed since the computer let the phone in, another
   account's list or chats, another computer answering, or a computer the person picked (no line for that one).
2. The link closes it: a press on back, or SwiftUI resetting the link when the screen is drawn again around a
   return. The system back button cannot be seen, so a close under 3 s after the app came back is taken as the
   screen's (`Board.chatClosedSoonAfterReturn`).
3. The Agents tab drawn again, losing its `@State`; if the chats were forgotten meanwhile, that reason is named.
4. iOS ended the app while away and it started again: a name kept in this phone's defaults says a chat was open.

## The change: a diagnostic, not a guessed fix

- `forgetChats(why:byPerson:)` records its caller in words; `take` records the source and the kind of change.
- `BoardClient.chatOpen` (with its epoch) and `cameBackAt`; the open chat's name in defaults for a relaunch.
- `Board.chatClosedCause` decides, as a pure function, whether a close gets a line and in which words; tested.
- The line: "At 2:14 PM, your chat with Dana closed: <why>." ("Found at ...: ... had closed: ..." when the close
  happened while the tab was gone), with a 44 pt close; a new chat clears it. Each close also goes to the device
  log under "[Chat]", every link close with its seconds since the return, and beside them the redraw triggers:
  each scene phase, the Tasks tab coming or going, the sign-in screen and the lock.
- An account change from the sign-in page cannot say whether the person or the page ended the sign-in, and says so.
- A link close while the app is not in front (the lock, or the screen tearing the tab down around a return) is not the
  person's: it goes through as before, and is logged and named ("the screen closed it while the app was not in front"),
  by this tab or, if it was torn down, by the next one. No close is stopped or undone: the branch only adds records and
  the one line.
- An account change keeps that a chat was open but drops the agent's name, so a tab drawn again says "a chat had
  closed" with the reason, and another account's agent name never shows.
- Known false readings: a cold start after the person swiped the app away with a chat open says the app was started
  again (the line says it may have been by hand); a press on back within 3 s of a return reads as the screen's.
- Weakest premise: the 3 s window. A person pressing back within 3 s of coming back would read as the screen's.

Rejected: a fix now. The causes need different fixes, and none is measured on Josh's phone. The line comes out
once the cause is found and fixed.

## Checks

- All iOS logic suites; review loop; simulator: back pressed more than 3 s after a return writes no line, and a
  computer the person picks writes none either; a real press on back within 3 s of a return reads as the screen's;
  "another computer answered" (the computer changed under them) writes one.
- The line names the last thing that changed the tabs (the Tasks tab, the sign-in screen, the lock, the return) when it
  came within 10 s, so a screenshot names the trigger and nobody needs the device log.
- The card stays open: done only when a real return on Josh's phone stays in the chat.
