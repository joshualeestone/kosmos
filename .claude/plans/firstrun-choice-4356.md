# firstrun-choice-4356: the first screen asks whether this Mac runs agents or connects to them (#4356 slice 1, step 1)

## Release switch (Liu Kang m2647)
- `let kosmosFirstRunChoice = false` in native-app/main.swift (KOSMOS_FIRSTRUN_CHOICE) is OFF on main:
  the app treats every Mac as run before reading anything, so there is no first screen and no connect,
  and first run is exactly as before. A test pins it off. #4382 (Johnny Cage, a connect Mac updating
  itself) turns it on in its own PR, so Connect reaches no release before a connect Mac can update.
- With it off, the app never writes the file, so on main it can only be absent or `run` (the
  migration), and both start the board as before. The installer is NOT behind the switch: it honours
  whatever file it finds. A Mac that chose connect (or has a damaged file) on a switch-on dogfood
  build keeps its board off through an update, and its lines say the app will stop it or ask, which a
  switch-off app does not do; that app starts the board as run, so the outcome heals. Known, accepted
  (review round 30).
- Also known (review round 30): a choice that becomes connect after the start step reads "will not
  start itself at login" before the end-of-run stop has written the marker; the file names this
  read-then-act window.
- Everything under "Finished means" below describes the switch ON.

## Finished means (Liu Kang's plan on the card, and m2433/m2435/m2442)
- On a fresh Mac, the app's first screen is exactly: the Kosmos logo, the heading
  "How would you like to set up Kosmos on this computer?", and three buttons,
  "Run agents on this computer", "Connect to agents on another computer" and
  "Run agents here and connect to other computers" (Josh 10:31, m2463; the third label is
  Splinter's proposal and lives in the markup only). Nothing else. A test pins the visible
  text as exactly the heading and the three labels, and the logo as present.
- Run agents here and connect: today's first run, then the existing Settings Kosmos Plus
  sign-in (plusSiEnter) as its last step. Board and installer treat it as run.
- The choice is recorded locally only (the mode file). No new outbound report (#4253).
- Run agents leads to today's first-run, unchanged.
- Connect stops the board the installer already started (and its launchd jobs, through
  board.stopped), and loads Kosmos Plus sign-in (https://login.kosmosplus.com/) in the
  app window. The person lands on their other computer's board. No model sign-in, no
  permissions, no tmux, no keep-awake, no launchd board on this Mac.
- The mode is stored where the installer and the update path can read it. An update on a
  connect-mode Mac never starts the board. test-install says so for a good update; its failed-
  update pair cannot fail until #4342 (Raiden's resume-on-failure trap) lands, and the #4342 ruling
  (Liu m2647) makes whichever PR lands second route that trap through _kosmos_board_decide, with a test.
- This Mac app's own menu can switch a connect Mac to Run agents (not web Settings: in
  connect mode the page is the other computer's).
- An unreadable mode shows the first screen again; it never silently picks a mode.
- Proven on a real signed-in account, not only in tests.

## Design (decided; Liu m2442 confirmed 1 and 2)
- The mode file: `$KOSMOS_HOME/mode`, one word, `run`, `connect` or `both`. Per computer (the
  install), not per Kosmos instance (#1852 instances share one install). Written by the Mac
  app, which knows KOSMOS_HOME (the board is not told it, server.js:48).
  - absent: never chosen. A fresh install is asked. An install from before this change gets
    `run` written by its next update when its first run is done (so a second Kosmos, #1852, on a
    Mac that has always run agents is not asked); the installer treats absent as run.
  - `run` / `connect` / `both`: chosen. `both` is run for the app and the installer; the app
    passes ?mode=both so the page ends first run at Kosmos Plus sign-in (frPlusLast).
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
  are skipped when the mode file exists and does not read exactly `run` or `both`. Raiden's #4342
  `_kosmos_resume_on_fail=no` stays outside that check (m2448).

## Weakest part
- That `kosmos stop` leaves the board down on a real connect Mac through a login and an
  update: board-run, the watchdog and KeepAlive all honour board.stopped (read, not yet
  measured on this change). Measure it on a real Mac before calling this finished.
- The iOS link rules are ported, not shared: two copies can drift.

## The approved design (Mona's mockup, Josh "perfect!", Liu m2474/m2475)
- Built from her 2560x1600 light and dark PNGs (Splinter copied them to Mortals). Measured at
  1280x800, device scale 2: the K 61x73.5 at (607, 179.5), heading 26px/700, three 280x225
  cards 22 apart at y 348 with radius 16, the art 30px into each card, labels 17px/600 under it.
- The K is the mockup's own pixels, recovered by difference matting of the light and dark
  versions (same mark on two known grounds), and inlined as a data URI (18 KB). The art is
  inline SVG in the mockup's 2x card coordinates (the monitor neck sits left of centre, as
  drawn). Its own light and dark tokens; the wizard behind it stays single-look.
- Measured match: every element's ink box within 0.5px of the mockup except the heading (1.5px
  narrower overall) and the labels (2px wider), which is font rasterising; 1.08% of pixels
  differ by more than 24/255 in light, 1.09% in dark, all half-pixel antialias edges.
  docs/evidence/firstrun-choice-4356/ holds the mockups and the renders side by side.
- No focus ring on load (the mockup has none); Tab reaches Run agents first.
