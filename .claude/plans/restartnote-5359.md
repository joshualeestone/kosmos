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

## Verification (so far)
- engine/restartnote-5359.test.js: 5/5 (every rule arm with a control; read-before-write; a day; dismiss).
- docs/browser-checks/render-reboot-note-5359.js against a fully sandboxed board: all PASS (today, yesterday, older,
  empty control, dismiss POST, role, label, neutral tone). Wired: browser-checks.sh run_one on $B8, b8-board.txt,
  README row, SITE_COUNTS line; the four wiring guards green.
- To do: design shots for Mona (light/dark, desktop/phone, with the login notice, phone over Settings tabs), the
  server route test, the challenge loop.

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
