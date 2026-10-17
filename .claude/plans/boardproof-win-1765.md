# boardproof-win-1765: Windows clients verify the board holds the token before sending it

**Posture:** production

Card: kosmos#1765, Windows half. Builds on boardproof-1765 (#6394: the board's `GET /api/board-proof` route and
`engine/boardproof.js`).

## What changes
- `engine/kosmos-report-hook.js`: before its first send, the hook checks the board holds its token
  (`boardHoldsToken`), once per process, within half the first send's bound; each send gets what is left. Not
  proven: nothing is sent and the hook exits 0. SessionStart's loud line tells a board that is down apart from a
  listener that could not show it is your Kosmos.
- `tools/windows/kosmos-cli.js`: every token-bearing request goes through `call()`, which checks first (half the
  request's bound, 0.5 to 15 s). A passed check is kept for the process, per token; a failed one is asked again.
  Not proven: nothing is sent, exit 1 (never 3, never a retry).
- `tools/kosmos-open-board.js`: checks before the board token goes to the sign-in mint. Not proven: nothing is
  opened and no address is handed out (exit 1), as `kosmos open` does on the Mac.
- `tools/windows/KosmosLauncher.cs`: `BoardProof`, the same exchange in C#, guards the one place the launcher sends
  `board.token` (the taskbar badge's status read). Source only: the signed `Kosmos.exe` is rebuilt and re-signed
  as its own release step.

## Decided
- **The opener opens nothing on a failed check**, not the plain address: the browser's sign-in cookie is scoped to
  127.0.0.1, not to the port. Rejected: opening the plain address (what was first asked for). Would change my mind:
  a cookie scoped to the port.
- **Test seam**: `proveBoard` on each sender. A caller that passes its own fetch (or the CLI's hook) is a test and
  gets no check unless it passes `proveBoard`; production passes none. Weakest part: a future production caller that
  passes a fetch would skip the check; the new tests drive the production path with nothing injected.
- **Fail closed** when `boardproof.js` will not load (it ships in the same engine folder in every bundle).

## Not covered (stated)
- The launcher's board window falls back to the plain address when the opener names none; it is unchanged here.
- The gap between the check and the send (two requests), as on the Mac.

## Tests
- `engine/kosmos-report-hook.board-proof-1765.test.js`, `tools.windows-kosmos-cli-board-proof-1765.test.js`,
  `tools.win-open-board-2007.test.js` (new #1765 arms), `tools.win-launcher-board-proof-1765.test.js` (source
  everywhere; a compiled probe on Windows, against the real board and stand-in listeners).
- Each new test went red with its check removed.
- Full node suite on the Windows box, branch vs main, compared by test name and reason: no new failure.
