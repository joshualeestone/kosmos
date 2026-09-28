# firstrun-choice-4356: the first screen asks whether this Mac runs agents or connects to them (#4356 slice 1, step 1)

## Finished means (Liu Kang's plan on the card, and m2433/m2435/m2442)
- On a fresh Mac, the app's first screen is exactly: the Kosmos logo, the heading
  "How would you like to set up Kosmos on this computer?", and two buttons,
  "Run agents on this computer" and "Connect to agents on another computer". Nothing else.
  A test pins the visible text as exactly those three strings and the logo as present.
- Run agents leads to today's first-run, unchanged.
- Connect stops the board the installer already started (and its launchd jobs, through
  board.stopped), and loads Kosmos Plus sign-in (https://login.kosmosplus.com/) in the
  app window. The person lands on their other computer's board. No model sign-in, no
  permissions, no tmux, no keep-awake, no launchd board on this Mac.
- The mode is stored where the installer and the update path can read it. An update on a
  connect-mode Mac, good or failed, never starts the board (a test says so).
- This Mac app's own menu can switch a connect Mac to Run agents (not web Settings: in
  connect mode the page is the other computer's).
- An unreadable mode shows the first screen again; it never silently picks a mode.
- Proven on a real signed-in account, not only in tests.

## Design (decided; Liu m2442 confirmed 1 and 2)
- The mode file: `$KOSMOS_HOME/mode`, one word, `run` or `connect`. Per computer (the
  install), not per Kosmos instance (#1852 instances share one install). Written by the Mac
  app, which knows KOSMOS_HOME (the board is not told it, server.js:48).
  - absent: never chosen (a fresh install, or every install before this change). Treated as
    run by the app, the installer and updates, exactly as today.
  - `run` / `connect`: chosen.
  - anything else, or unreadable: the app starts the board and shows the choice screen
    again; the installer does not start the board (it cannot ask; an update's own pause has
    stopped it, and the app's next launch starts it and asks).
- The choice screen is its own overlay (#fr-choice), not a wizard pane, so the wizard's
  chrome and screen-reader lines are not on it. It shows only in the Mac app (the page
  sees the app's `kosmosMode` message handler) and only when the app says the mode is
  unset (`?mode=unset`, with first run not done) or unreadable (`?mode=unreadable`).
  Run agents: tell the app `run`, then the wizard as today (or close, when first run was
  already done). Connect: tell the app `connect`; the app does the rest.
- Connect, in the app: write `connect`, run `kosmos stop` off the main thread, stop the
  board-only timers (Dock badge, Accessibility checks, prompt watcher), then load the
  sign-in page. At later launches the app reads the mode before loadBoard() and never
  starts the board. A main-frame navigation policy, applied only in connect mode and ported
  from iOS ShellLogic.isOurs/linkDecision, keeps login.kosmosplus.com and
  <name>.kosmosplus.com in the window and sends other https to the browser (Sub-Zero's
  slice-2 ?open= intent rides on this).
- The menu: "Run agents on this computer" (shown in connect mode) writes `run`, and runs
  loadBoard() (kosmos start clears board.stopped), which shows the wizard since first run
  was never done.
- The installer: the two places an install or update starts the board (setup.sh
  `kosmos start` at "Starting Kosmos.", and `kosmos restart` after the launchd bootstrap)
  are skipped when the mode file exists and does not read exactly `run`. Raiden's #4342
  `_kosmos_resume_on_fail=no` stays outside that check (m2448).

## Weakest part
- That `kosmos stop` leaves the board down on a real connect Mac through a login and an
  update: board-run, the watchdog and KeepAlive all honour board.stopped (read, not yet
  measured on this change). Measure it on a real Mac before calling this finished.
- The iOS link rules are ported, not shared: two copies can drift.
