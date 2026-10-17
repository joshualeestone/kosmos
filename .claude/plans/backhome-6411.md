# backhome-6411: View > Back to This Computer, while the window shows another computer

Card: kosmos#6411, part 1. Stacked on cmdcomma-6411 (part 2), whose isOwnSettingsPage it reuses.
⚠️ Adds a visible menu item: held from merging under the current clean-UI hold until Splinter clears it.

## What changes
- `native-app/main.swift`: `showsAnotherComputer(page, board, ownPlusHost)` (pure): the page is a Kosmos+ computer
  page (isBoardPage, which leaves out the Kosmos+ service sites) and not this computer's own (isOwnSettingsPage).
- View > Back to This Computer (Cmd-Shift-H), built hidden. `updateBackHomeItem` shows it only while the window is
  on another computer of a run or both computer (a connect computer has no board of its own), re-deciding at every
  page commit, when the page process ends, and on every mode switch (from updateRunAgentsItem).
- A hidden item's key equivalent is ignored (NSMenuItem.h), so the shortcut works exactly while the item shows.
  `backToThisComputer` still checks again (the address file can change after the commit that showed it), refuses
  with a beep while a board start is in flight, and holds off with runAgentsHere's "One moment" alert while an
  update is copying files in (#4382). Otherwise it brings the window forward and calls `loadBoard`, the launch path: the
  board is found running (or started) and its own page loaded. It does not mark the start user-initiated: that
  wording (#965) says to press Cmd-R, which here would reload the other computer's page, not retry; as
  runAgentsHere, a failed start gets the launch wording.
- The mode selftest gains seven rows (145); the bundle build's menu table gains the row.

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
- Mode selftest rows (compiled and run here: 145 rows, all good): another computer (with and without an address of
  its own), this computer's own address, the own board, Kosmos+ sign-in, a foreign site, no page.
- Menu selftest matches the build's expected table (run here, diffed: identical).
- native-app.backhome-6411.test.js pins what no selftest reaches: built hidden with a target and the shortcut, the
  table row, re-decided at commit, process end and mode switch, and before loadBoard the action's re-check, its
  update hold, and that it is not marked user-initiated.
