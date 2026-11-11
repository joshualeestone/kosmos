# startedproof-8372: a session start proves life on the agent's own token

Card: kosmos#8372. On Windows every Claude session opened with "Kosmos reporting is OFF for this session: the board
refused it (we could not match that to one of your agents)", while its later reports were recorded.

## Why (from the code; the live check is Homer's, on the box)
resolveAgentSender authenticates an agent token by (1) a roster row, or (2) its name plus a live heartbeat. The heartbeat
is written only after an authenticated report (the report route's liveness.seen). On Windows the roster row appears only
once Claude Code registers the session, a moment after SessionStart (win32supervisor's registrationGraceMs). The per-run
token is minted before launch (win32create.mintForRun), so it is already held. So the `started` report had neither a row
nor a heartbeat: NO_MATCH. Later reports find the row. On the Mac the pane exists first, so path 1 holds.

## Change
- resolveAgentSender takes `opts.startedReport`: with it, a token that resolves BY NAME (held, not retired, and with no
  second name under its key) is accepted for that one report, as the paneless card. The report route sets it only for
  `state === 'started'`. The route already beats liveness after any authenticated report, so the next reports pass on
  path 2 while registration catches up.
- Unchanged: an unknown, revoked or ambiguous token is refused with the same words; every other state needs a row or a
  heartbeat as before; the Mac never reaches this branch at SessionStart.

## Rejected
A hook-side retry (races registration inside the hook's 8 s budget), rewording only (the first report would still be
lost), a supervisor-side start (Windows-lane code; the board already has the token).

## Tests
server.startedproof-8372.test.js (3): a first `started` on a held token with no row and no heartbeat is recorded and
beats liveness, and the next `working` passes; CONTROL a no-row agent's `working` with no start is still refused; a
never-issued or revoked token's `started` is refused and beats nothing. 5 mutation arms red. 263 related files: one red,
engine/create.test.js, only under the sweep's temp HOME, and red the same way on main (control): not this change.
