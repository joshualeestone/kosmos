# #5359 part 1: a board note when this computer restarted under a running Kosmos

**Branch:** `restartnote-5359` · **Card:** kosmos#5359 (field ideas; part 2, `kosmos accounts`, is accountsverb-5359)

## The change
- engine/restartnote.js: the board writes when it was last alive (once a minute). At start it reads that BEFORE
  writing its own, and compares it with the computer's boot time (os.uptime()). A note is made only when the board
  was alive within 15 minutes before this boot AND this start is within 15 minutes after it. Kept a day or until
  dismissed. The board has no shutdown hook, so it asks the computer, not how the last run ended.
- server.js: start() calls atStart() and starts the beat; GET /api/board/restart-note and POST .../dismiss.
- web/index.html: #reboot-slot in the #topnotes stack after #login-adv-slot (Mona Lisa's design: the login notice's
  .utoast, neutral tone restated in each theme block, the words role=status, a Dismiss button). Copy: "This computer
  restarted at 7:15 PM" / "Kosmos was running and started again by itself at 7:22 PM." Not today: "yesterday at",
  then "on Oct 5 at".

## Decided, not missed
- "Restarted", never "crashed": nothing here can tell a crash from a person's restart.
- No "your agents are running again": not measured (Mona: never say it unmeasured).

## Verification
- engine/restartnote-5359.test.js 7/7 (every rule arm with a control, both window edges to the millisecond; read-before-write; a day; dismiss; clock slack;
  the beat under mocked timers and its rate against the window), server.restartnote-5359.test.js (routes, the start
  write, the beat armed), cli.restartnote-stop-5359.test.js 3/3, install.uninstall-remembered-1531.test.js 5/5, and
  the repo guards: 56/56 together.
- docs/browser-checks/render-reboot-note-5359.js against a fully sandboxed board: all PASS. Wired: browser-checks.sh
  run_one on $B8, b8-board.txt, README row, SITE_COUNTS line; the wiring guards green.
- Design shots done and approved by Mona at dd2f52a56 (~/work/design-shots/kosmos-5359/).

## Review 2 (fixed)
- `kosmos stop` clears board-alive.json only after the board is confirmed gone (next to removing the pidfile): before
  the kill a beat could write it back, and a failed stop must not erase a live board's record. Pinned in
  cli.restartnote-stop-5359.test.js (clear after death; a failed stop keeps it; only that file is removed); moving the
  clear back before the kill reddens two arms (measured).
- The claim "a deliberate stop never makes a note" was true only of the Mac `kosmos stop`. Narrowed in
  engine/restartnote.js: quitting the app, and every stop on Windows, leaves the record, so stop + computer restart +
  start within the window still makes a note.
- REJECTED: clearing the record on SIGTERM in the board. An ordinary shutdown SIGTERMs every process, so a Mac would
  lose the note for every restart, and the two platforms would differ. Weakest premise: that a person who stops Kosmos
  and restarts within 15 minutes is rare enough that a mistaken note costs less than losing the note on every Mac
  restart. What would change it: a report of that note being wrong in practice.
- The ten-minute re-check no longer repaints the same note (it took focus off Dismiss and re-announced the status).
  Pinned in render-reboot-note-5359.js with a control that serves a different note; removing the guard reddens it.
- The restart-note routes moved above the what's-new comment block, which they had split from its route.
- Decided, not missed: the rule takes now minus uptime as the boot time, so a clock corrected after boot can move it
  and miss or fake a note. Accepted for a courtesy note.

## Review 3
- FIXED (a regression of my review 2 fix): the re-check guard keyed on the note's times, so "at 11:30 PM" never became
  "yesterday at 11:30 PM" after midnight. It now keys on the painted words. Pinned by a midnight arm in
  render-reboot-note-5359.js (the page clock pinned at 23:30, then 00:10); keying on the times again reddens it.
- Decided, not missed: an outage longer than WINDOW_MS (a machine back after 20 minutes, a laptop dead overnight) makes
  no note. Widening the "alive before boot" window was rejected: a record left by a stop that does not clear it
  (quitting the app, Windows) would then say "Kosmos was running" after any quit within the wider window. Weakest
  premise: that long outages are rarer than quits followed by a restart. What would change it: every stop path
  clearing the record, after which the window could widen safely.
- Decided, unmeasured: Windows Fast Startup. A "Shut down" there hibernates the kernel, and os.uptime() may not reset,
  so a shutdown and power-on may make no note. A blue screen and a power cut are cold boots and reset it, which is the
  card's case. A deliberate shutdown making no note is acceptable. Not measured: no Windows machine here.
- Left as consistent with the login notice: the status region is inserted with its words (the login notice does the
  same); REBOOT_SEEN_START's position (tick() runs after the script body); a temp file left by a kill mid-write
  (one write a minute, harmless); a dismiss racing a new note (a courtesy note).

## Review 4
- Decided, filed as #5450: "started again by itself" is decided by the board starting within WINDOW_MS of the boot, a
  stand-in for the supervisor starting it. Weakest premise: Kosmos starts at login and people log in within 15 minutes
  of a boot (a person opening Kosmos quickly gets a false note; a machine waiting at a login screen longer gets none).
  The fix is a marker from the supervisor; its Windows half is supervisor code for Homer, and a Mac-only marker would
  make the platforms differ, so it is not in this PR.
- FIXED: the browser check now asserts the neutral tone in dark by media query, forced dark and Kosmos+ (measured
  against the toast's own --label-2, which Kosmos+ redefines on body). Removing the three dark lines reddens all three.
- FIXED: the re-check when the board's start time moves under an open page is pinned (a control with the same start
  time first). Removing it reddens the arm.
- FIXED: a dismiss the board refuses keeps the note and says "Kosmos could not record that just now. Try again in a
  moment." in its status words. Pinned with a 500 from the route. This is a new line in the note's failure state only.
- FIXED: the dated cases run at a pinned noon; a refused or failed re-check leaves a showing note alone; a note is still
  shown with the clock up to a minute behind it (engine test, mutation red).


## Review 5
- FIXED: the once-a-minute beat was unpinned (removing it, or slowing it to an hour, left every test green, and without
  it a board up for hours before a crash never makes a note). Pinned: the beat moves the record each minute under
  mocked timers, its rate is held to at least five per window, and the server test asserts start() arms it. All three
  mutations red.
- FIXED: uninstall now removes board-alive.json and board-restart-note.json with the other remembered-answer files
  (install/setup.sh, count now six). install.uninstall-remembered-1531.test.js reads both names from
  engine/restartnote.js and checks the rm line; dropping one reddens it. tools/test-install.sh is not extended: it
  seeds only the first three files, and the node guard reads the rm line itself.
- FIXED: the "board is told" arm no longer counts the refused click's POST; every case first waits for the page's
  own request for the note, so the empty control means "asked, none", not "not yet".

## Review 6
- FIXED (test gap): focus after a dismiss is pinned with a keyboard dismiss; deleting the focus call reddens it
  ("BODY"). The reviewer's probe saw focus on `.tip-go` because it did not close the first-run screen, whose button
  holds focus while it shows; with it closed, focus lands on the K mark as after the login notice.
- Named, not fixed here: switching to another Kosmos stops this one's board without clearing its record, the same
  class as quitting the app. In the header comment and on #5450 (the supervisor marker fixes all of them).
- FIXED: a second refused dismiss says its line again (removed and re-added, so it is announced); Kosmos+ is tested in
  dark (it ran in light before); the check's header and README row list every arm; the routes sit above the
  pre-existing engineering-mode comment, not under it; setup.sh says four of the six are "asked yet" facts.
- For Mona, with the failure line: the close button is labelled "Dismiss" alone, where the login notice says
  "Close: <its headline>". Left as her design says; raised to her.
- Left: a temp file from a kill mid-write is not swept by uninstall (exact names; accepted in review 3).

## Review 7
- FIXED: the window edges are pinned to the millisecond on both sides (and the window to 15 minutes); `>` to `>=` or a
  one-second widening now reddens. The phone rule that keeps the note's line is asserted at 390px. The "yesterday"
  case requires "yesterday at" in the line. Each mutation-proven.
- Left: `cmd_stop` with the real clear end to end (its arms replace the clear; the third arm runs the real clear).

## Review 8
- FIXED (my review 6 change had weakened it): Kosmos+ is now tested in light as well as dark. In dark the dark rule
  alone keeps the tone, so only light tests the Kosmos+ rule; removing `.reboot` from that rule reddens it.
- FIXED: a re-check that repaints the note under a focused Dismiss keeps focus on the new Dismiss; one that removes it
  moves focus to the K mark. A later re-check the board answers clears a stale "could not record that just now".
  Each pinned and mutation-proven. The phone arm is listed in the check's header and README row.
- FIXED: server.restartnote-5359.test.js loads tmpscope, so its temp folders are removed.
- Left: a board started outside launchd can write board-alive.json back after uninstall's rm (uninstall stops only
  the launchd job); the same is true of the folder's other residue.

## Full validation at 2384b039d
- FULL browser checks PASSED at 2384b039d (all page checks passed, 03:19).
- The Mortals full suite FAILED on one source pin: server.preview-sweep-5254.test.js wants filepreview.sweep() within
  400 characters of `function start(port = PORT) {`, and the restart-note block at the top of start() pushed it out.
  The block now sits just below the file-preview sweep lines (the two are independent); both start() pin files and the
  restart-note tests green. Only server.js moved; the browser checks' pages are unaffected.
