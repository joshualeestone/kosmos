# startedproof-8372: a session start proves life on the agent's own token

Card: kosmos#8372. On Windows every Claude session opened with "Kosmos reporting is OFF for this session: the board
refused it (we could not match that to one of your agents)", while its later reports were recorded.

## Why (from the code; the live check is Homer's, on the box)
resolveAgentSender authenticates an agent token by (1) a roster row, or (2) its name plus a live heartbeat. The heartbeat
is written only after an authenticated report (the report route's liveness.seen). On Windows the roster row appears only
once Claude Code registers the session, a moment after SessionStart (win32supervisor's registrationGraceMs). The per-run
token is minted before launch (win32create.mintForRun), so it is already held. So the `started` report had neither a row
nor a heartbeat: NO_MATCH. Later reports find the row. On the Mac the pane exists first, so path 1 holds.

## Change (as it stands after three review rounds)
- resolveAgentSender path 2b (opts.startedReport, from startedMayProveLife): a `started` report is accepted with no
  roster row and no heartbeat when ALL hold: the board runs on Windows; the request is from this computer (a loopback
  socket peer AND no forwarding header); the token resolves BY NAME (held, not retired or revoked, not ambiguous) and is
  not tagged launcher 'remote'; the agent has a Windows session record (written before its run token is minted) or a
  profile; and it has no removal record. The route then beats liveness, so the next reports pass on path 2.
- sendertoken.resolveName also returns the token's launcher.
- Review 1 (measured by the reviewer): the first version let ANY held token bootstrap a heartbeat, a remote one from the
  network included. Review 2: Windows boards only (a Mac run's kept token stays mute) and a session record counts as
  created. Review 3: "this computer" is the socket peer, not headers alone (with the network bind open a direct caller
  sends no forwarding header).
- Residual: on a Windows board, a local, untagged, held token whose run crashed without retiring it can show "running"
  for one beat (liveness.STALE_AFTER_MS) per call, as a still-beating one already could. Also an adopted agent's token
  (adopt.js mints untagged), from this computer only. And a reverse proxy the person runs ON this computer that adds no
  forwarding header reads as local (review 4; the board's own BOUNDARY note names this class): still a held, untagged,
  unambiguous token for a created, unremoved Windows agent, for one beat per call.

## Rejected
A hook-side retry (races registration inside the hook's 8 s budget), rewording only (the first report would still be
lost), a supervisor-side start (Windows-lane code; the board already has the token).

## Tests
server.startedproof-8372.test.js (8): the first `started` on a held token with no row and no heartbeat is recorded and
beats liveness, and the next `working` passes; CONTROL a no-row agent's `working` with no start is still refused; a
never-issued, revoked or retired token is refused; a remote-tagged token, a never-created name, a removed agent and a
forwarded request are refused (each beside a local control that is recorded); a Mac board refuses; a brand-new agent
with only its session record is recorded; a non-loopback socket peer is refused. 12 mutation arms, all red.
