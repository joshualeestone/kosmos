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
- resolveAgentSender path 2b (opts.startedReport): a token that resolves BY NAME (held, not retired or revoked, not
  ambiguous) is accepted for a `started` report when startedMayProveLife holds: the token was NOT issued to another
  computer (launcher 'remote'), Kosmos has a profile for the agent, and the agent was not removed. The report route sets
  startedReport only for `state === 'started'` from this computer (not through the remote forwarder). The route then
  beats liveness, so the next reports pass on path 2 while registration catches up.
- sendertoken.resolveName also returns the token's launcher.
- Review 1 (measured): the first version let ANY held token bootstrap a heartbeat by sending `started`, including a
  remote-issued one from the network, a token for a never-created name, and a removed agent whose revoke failed. Each is
  now refused, with a test and a mutation arm.
- Review 2: only on a board running on Windows (a Mac or Linux pane exists before Claude starts, and a Mac run that
  ended without retiring its token must stay mute); "created here" is a Windows session record (written before the run
  token is minted, so a brand-new agent's first start passes) OR a profile.
- Residual, stated: on a Windows board, a local run's token whose run crashed without retiring it can show "running" for
  one beat (liveness.STALE_AFTER_MS) per call, as a still-beating one already could. A token minted before launcher tags
  existed (#4530) and issued to another computer carries no 'remote' tag; it still needs a session record or profile
  for its name and a request from this computer.

## Rejected
A hook-side retry (races registration inside the hook's 8 s budget), rewording only (the first report would still be
lost), a supervisor-side start (Windows-lane code; the board already has the token).

## Tests
server.startedproof-8372.test.js (3): a first `started` on a held token with no row and no heartbeat is recorded and
beats liveness, and the next `working` passes; CONTROL a no-row agent's `working` with no start is still refused; a
never-issued or revoked token's `started` is refused and beats nothing. 5 mutation arms red. 263 related files: one red,
engine/create.test.js, only under the sweep's temp HOME, and red the same way on main (control): not this change.
