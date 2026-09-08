# pause-foreign-board-964 — the update pause check must tell OUR board from a foreign Kosmos

Card: kosmos#964 ("A stale install whose recorded port is held by a DIFFERENT Kosmos can
never update in place: the pause check matches any Kosmos-shaped body, not this install's
own board").

## The bug

During an in-place update, `install/setup.sh` runs `kosmos stop`, then curls
`http://127.0.0.1:$PORT/` and case-matches the body for `Agent Workforce`/`Kosmos`. ANY
Kosmos-shaped answer is treated as THIS install's unpausable board, and the update dies:
"A Kosmos board is still running on port $PORT and could not be paused ... ('kosmos stop',
...)". The check distinguishes Kosmos-vs-another-app but never MY-board-vs-ANOTHER-Kosmos.

On a multi-account Mac, a pre-#910 stale install records port 16180, which a second Kosmos
(another account/install) can legitimately hold. The returning user with a weeks-stale
Kosmos then gets an update that can never complete: their own board is already dead, so the
advised `kosmos stop` is a no-op, and pasting the install line again refuses identically
forever. Found on the aged specimen (0.2.36, ~30 versions stale), 2026-08-26.

## The fix

The install records its board's pid in `$KOSMOS_HOME/board.pid`. The answering board on
$PORT is ours only if that pid is running THIS install's server -- matched by command
against `$KOSMOS_HOME/app/server.js`, exactly the strict identity check the same file
already uses for `BOARD_OURS` (whose comment warns "a recycled pid, or another install's
live server behind a stale pidfile, must not read as ours"). A bare `kill -0` is NOT
enough: the card's primary scenario is a board dead for weeks on a machine that has since
REBOOTED, so the stale pid NUMBER has very likely been reused by an unrelated live
process -- `kill -0` would pass it and wrongly take the "our board" branch, re-arming the
forever-loop. Branch on the strict match:

- **pid runs our server (`_ourboard=yes`)** — genuinely will not pause: unchanged #2055
  behavior (record the board-would-not-pause abort streak, die with the "kosmos stop"
  advice).
- **pid dead / absent / garbage / a live but foreign process** — a foreign Kosmos holds
  our port: die with actionable advice (quit that board, or reinstall on a free port via
  `KOSMOS_PORT`), and do NOT inflate the board-would-not-pause streak (that streak is about
  OUR board; inflating it here would mask a machine whose own board really cannot pause).

## Why it is fail-safe

The change only refines which error message an ALREADY-FAILING pause shows; it never makes
a working update fail. A false "dead" shows the foreign-board message when ours was alive
(a suboptimal message, not a brick); a false "alive" keeps today's behavior. Worst case in
either direction is a suboptimal sentence on a path that was already aborting.

## Rejected / not done

- Comparing the served /api/status identity (version + store path) was the card's second
  option. The board.pid command-match already answers "is this our board?" without an HTTP
  parse, so the served-identity comparison is unnecessary and left unbuilt.
- A bare `kill -0` liveness check (the first draft) was rejected in review: it fails the
  card's own primary scenario (a reused pid on a rebooted machine reads as "our board
  alive"). The ps-command match against `app/server.js` is what handles it, and a test arm
  now exercises a live-but-foreign pid.

## Verification

- `tools/test-pause-foreign-board-964.sh` (wired into `test:shell`) extracts the shipped
  `case "$_pausebody"` arm and drives it with `die` stubbed across: our running board (a
  real sleeper AT `$H/app/server.js` so the ps-command match reads it as ours) -> keeps the
  "could not be paused" die + records the streak; a LIVE but foreign pid (the reused-pid
  case) -> foreign die, streak NOT recorded; a dead pid and an absent board.pid -> foreign
  die; plus controls (non-Kosmos body -> "Another app" die, empty body -> no die). Runs the
  arm under `set -eu`.
- The existing `tools/test-update-abort-2055.sh` still passes (the #2055 record block is
  kept contiguous inside the alive branch, so its anchors are unchanged).
- **Not verified by me:** the end-to-end update on the aged specimen at
  `~/walkbases/specimen-0236/` (the card says it can re-run once this check is fixed). That
  is a live re-test on a real stale install, which a bot session cannot drive — routing it
  to whoever holds the specimen (Splinter's call).
