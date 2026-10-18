# backhome-6411: View > Back to This Computer, while the window shows another computer

Card: kosmos#6411, part 1. Stacked on cmdcomma-6411 (part 2), whose isOwnSettingsPage it reuses.
⚠️ Adds a visible menu item: held from merging under the current clean-UI hold until Splinter clears it.

## What changes
- `native-app/main.swift`: `showsAnotherComputer(page, board, ownPlusHost)` (pure): the page is a Kosmos+ computer
  page (isBoardPage, which leaves out the Kosmos+ service sites) and not this computer's own (isOwnSettingsPage).
- View > Back to This Computer (Cmd-Shift-H), built hidden. `updateBackHomeItem` shows it only while the window is
  on another computer of a run or both computer (a connect computer has no board of its own), re-deciding at every
  page commit, when the page process ends, and on the mode switches that go through updateRunAgentsItem (to connect,
  and Run agents here back from connect). The switches from not chosen yet to run or both do not need to: the rule
  is the same for unset, run and both.
- A hidden item's key equivalent is ignored (NSMenuItem.h), so the shortcut works exactly while the item shows.
  `backToThisComputer` still checks again (the address file can change after the commit that showed it), refuses
  with a beep while a board start is in flight, and holds off with runAgentsHere's "One moment" alert while an
  update is copying files in (#4382). Otherwise it brings the window forward and calls `loadBoard`, the launch path: the
  board is found running (or started) and its own page loaded. Just before loadBoard it sets `boardStartFromBackHome`;
  loadBoard reads it into that start's origin (`BoardStartOrigin`: launch, reload, backHome) and clears it before any
  of its returns, so it belongs to exactly one start however that start ends. A start from this item that fails or
  hangs (the failure alert, the 300 s watchdog) says to try again by choosing View > Back to This Computer
  (Cmd-Shift-H), not Cmd-R, which on another computer's page reloads that page and starts nothing. Otherwise the
  failure says what Reload's does, including its fallback (if it keeps failing, installing it again usually fixes
  this); the two differ only in the retry step, and one string serves both. Leaving boardRecoveryIsUserInitiated
  unset could not have done this, since it is never reset and so is true after any Reload. The advice is written once,
  in the pure `boardStartRetry` (used by the watchdog and the failure remedy) and `boardStartFailureRemedy` (launch,
  reload and back-home cases).
- "Choose it again" needs the item to be shown when the message appears. After a failed start the window normally
  still shows the other computer (committedPageURL unchanged), so it is; but if the page process ended meanwhile,
  committedPageURL is nil and the item is hidden. The pure `boardStartAdviceOrigin(origin, itemShown:)` decides, when
  the alert or watchdog message is shown, which advice to give: a back-home start whose item has gone advises as
  Reload does. The item also stays shown while a board start is in flight; a press then beeps, since the start is
  already under way.
- The item can be gone when the message shows for more than one reason, and in each the Reload advice applies to the
  page on screen: the person moved to a page of this computer's own board (Cmd-R reloads it or starts the board:
  right); the address file now marks the page as this computer's own (Cmd-R reloads it: harmless); the mode became
  connect; or the page process ended. In connect the start's result is dropped (its completion returns before any
  alert), but switchToConnect neither clears boardStartInFlight nor bumps boardStartGeneration, so a start still hung
  at 300 s still shows the watchdog alert, with Reload's advice (isOnAnotherComputer is false in connect). That is
  older behaviour and barely reachable from this item; harmless.
- Weakest premise: when the page process ended, the Reload advice is two steps, not one. Reasoned from WebKit
  behaviour, not measured: the ended page keeps backForwardList.currentItem and loadBoard reset lastLoadFailed, so
  Cmd-R reloads the other computer's page, which brings View > Back to This Computer back, and choosing it then starts
  the board. Not changed: a one-step answer needs a change to how a crashed page is handled, too wide for a case this
  rare.
- On another computer's page Cmd-R usually just reloads that page; only if that reload's navigation fails does
  handleNavigationFailure fall through to loadBoard once (recoverOnReloadFailure) and start the board.
- The mode selftest gains sixteen rows (154: seven showsAnotherComputer, three board-start retry wording, six
  advice-origin); the bundle build's menu table gains the row.

## Decided
- Hidden, not greyed out, when not on another computer: on this computer it would only be noise in the menu.
- loadBoard rather than a stored URL: the board URL carries a token that can change, and loadBoard already resolves
  the install, the port and the token, and resets the Dock badge timer for that port.
- Cmd-Shift-H: free in this menu bar (Cmd-H hides, Cmd-Opt-H hides others) and Finder's "Home" shortcut.
- Windows has its own app (Homer's lane): a spec goes to Homer.
- Weakest premise: that the Kosmos+ page on screen is "another computer" whenever it is a Kosmos+ computer page and
  not this computer's own address. A stale `address` file (see cmdcomma-6411) would make this computer's own page
  read as another, and the item would offer a way back to the local board: harmless.

## Tests
- Mode selftest rows: another computer (with and without an address of its own), this computer's own address, the
  own board, Kosmos+ sign-in, a foreign site, no page; and one row per start origin (launch, reload, back home), each
  reading both wording functions; and boardStartAdviceOrigin for each origin with the item shown and hidden. 154 rows
  (145 plus three start-origin and six advice-origin rows, each `ran += 1` once): compiled at ae6315c6, every row
  passed (the native tests exit 0).
- Menu selftest matches the build's expected table (run here, diffed: identical).
- native-app.backhome-6411.test.js pins what no selftest reaches: built hidden with a target and the shortcut, the
  table row, re-decided at commit, process end and the switches through updateRunAgentsItem, and before loadBoard
  the action's re-check, its update hold, and the back-home marker; that loadBoard takes and clears the marker
  before any return, that it is set and cleared in one place each, and that the watchdog and failure alert both
  follow the start origin.
