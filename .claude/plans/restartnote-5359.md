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
