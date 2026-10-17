# cmdcomma-6411: Cmd-, opens Settings only when the window is on this computer's own board

Card: kosmos#6411, part 2 (part 1, a way back to this computer, is a separate branch: it adds a menu item, which
is held under the current clean-UI hold).

## What changes
- `native-app/main.swift`: `isOwnBoardPage(page, board)` (pure) says whether the page on screen is this app's own
  board, the host and port it loaded. `isBoardPage` keeps its Kosmos+ half and reads `isOwnBoardPage` for the rest,
  so the own-board rule is written once.
- `isOwnSettingsPage(page, board, ownPlusHost)` (pure) adds this computer's own Kosmos+ address, which
  `ownKosmosPlusHost()` reads from the board's own record (engine/remote.js address(): `address` in the tunnel
  state dir), when asked, never cached.
- `openSettings` (the Settings menu item and Cmd-,) refuses with a beep unless the committed page is this
  computer's: its own board or its own Kosmos+ address. Since #6406 a run or both
  computer can show another computer in the window; its Settings tab was clicked while the menu read as this
  computer's.
- `--kosmos-app-mode-selftest` gains 26 rows; its expected count goes from 112 to 138.
  - isOwnBoardPage (10): own board; another computer; another local server; localhost against 127.0.0.1; a
    connect computer; no page yet; a user part; ftp; https with no port; the loaded host in any case.
  - isOwnSettingsPage (12): own Kosmos+ address; its host in any case; another computer's address; no address of
    its own; an http address; another port; a user part; a file naming a host that is not a Kosmos+ address; the
    own board with and without an address; another local server; the file's host in any case. It leaves the
    scheme, user, port and name rules to isKosmosPlusURL and adds only "its own".
  - ownPlusHostFrom (4): the file as written (host and newline); trimmed and lowercased; empty; no file.

## Decided
- Refuse rather than navigate home first: the board URL is a tokenized load (loadBoard's resolve path), and
  navigating away would also discard anything typed on the other computer's page. A way home is part 1.
- The refusal matches the connect-computer refusal (#4356): a beep and a log line. The item is not hidden per
  page: that would need re-evaluating on every navigation for a key that already beeps.
- Before the first page commits there is no page to drive, so Cmd-, refuses there too, explicitly (before this
  change that case depended on what the page script did on a blank page; not measured).
- This computer's own Kosmos+ address counts as this computer: it is where another computer's switcher sends a
  person back, so refusing it would refuse Cmd-, after every visit to another computer. The app reads that
  address from the board's file; a computer never set up for Kosmos+, or forgotten, has none, and then only the
  local board counts (one switched off but still signed in keeps its address, and its own page still counts).
- The refusal comes before the window is brought forward: a hidden window stays hidden and beeps.
- Weakest premise: that the board's `address` file is current. It is written when Kosmos+ is set up and removed
  (best effort) when the computer is forgotten. If one outlived a forget and the name later went to another
  computer, Cmd-, there would open that computer's Settings: the narrow case this change otherwise closes.
- It fails closed in two passing moments: between a click back to this computer and that page committing (the
  old page is still the committed one), and on the old address just after this computer is renamed. Both beep.
- AGENT_WORKFORCE_TUNNEL_STATE is read from the app's own environment; a board started with it does not hand it
  over (tests and development only), so there the person's own Kosmos+ address may beep.
- Windows has its own app (Homer's lane); a spec goes to Homer.

## Tests
- The mode selftest's new rows (compiled and run here: 138 rows, all good). The file-path half of
  ownKosmosPlusHost (the override and the store path) is pinned by source text, as no selftest reads a real file.
- native-app.cmdcomma-6411.test.js pins the guard inside openSettings, after the connect refusal and before the
  window or page is touched, isBoardPage reading isOwnBoardPage, the selftest rows, and that the app reads the
  same `address` file engine/remote.js keeps.
- native-app.computer-mode-4356.test.js and native-app.download-5167.test.js pin the new row count.
