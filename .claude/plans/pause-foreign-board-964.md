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

The install records its board's pid in `$KOSMOS_HOME/board.pid`. If that pid is DEAD (or
the file is absent/garbage), our board is already stopped and whatever answers on $PORT is
a DIFFERENT Kosmos. Branch on it:

- **our board pid ALIVE** — genuinely will not pause: unchanged #2055 behavior (record the
  board-would-not-pause abort streak, die with the "kosmos stop" advice).
- **our board pid DEAD / absent** — a foreign Kosmos holds our port: die with actionable
  advice (quit that board, or reinstall on a free port via `KOSMOS_PORT`), and do NOT
  inflate the board-would-not-pause streak (that streak is about OUR board; inflating it
  here would mask a machine whose own board really cannot pause).

## Why it is fail-safe

The change only refines which error message an ALREADY-FAILING pause shows; it never makes
a working update fail. A false "dead" shows the foreign-board message when ours was alive
(a suboptimal message, not a brick); a false "alive" keeps today's behavior. Worst case in
either direction is a suboptimal sentence on a path that was already aborting.

## Rejected / not done

- Comparing the served /api/status identity (version + store path) was the card's second
  option. The board.pid liveness check is sufficient, simpler, and needs no HTTP parsing —
  a dead own-pid already proves the answering board is not ours. Left the served-identity
  comparison unbuilt as unnecessary.

## Verification

- `tools/test-pause-foreign-board-964.sh` (wired into `test:shell`) extracts the shipped
  `case "$_pausebody"` arm and drives it with `die` stubbed and board.pid alive/dead/absent:
  asserts the alive path keeps the "could not be paused" die + records the streak; the
  dead/absent path gives the "Another Kosmos ... KOSMOS_PORT" die, dispels `kosmos stop`,
  and does NOT record the streak; plus controls (non-Kosmos body, empty body).
- The existing `tools/test-update-abort-2055.sh` still passes (the #2055 record block is
  kept contiguous inside the alive branch, so its anchors are unchanged).
- **Not verified by me:** the end-to-end update on the aged specimen at
  `~/walkbases/specimen-0236/` (the card says it can re-run once this check is fixed). That
  is a live re-test on a real stale install, which a bot session cannot drive — routing it
  to whoever holds the specimen (Splinter's call).
