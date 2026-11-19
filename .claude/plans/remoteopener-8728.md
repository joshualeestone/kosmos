# remoteopener-8728: a Claude sign-in started from a remote session opens no browser on this computer

Card: kosmos#8728 part 2 (the remote login-refresh chain), first slice. Part 1 is branch capask-8728.

## Why
Josh refreshes a Claude login on his Mac from his laptop or phone through Kosmos+. The board runs
`claude auth login --claudeai` in a tmux pane on that Mac. Claude opens a browser itself, so a Claude authorize tab
appears on the remote Mac's screen, where nobody is. Its link carries `redirect_uri=http://localhost:<port>/callback`, so
a press of Authorize there would sign in whichever claude.ai account that browser holds. The person never needs it:
the page shows the link Claude prints (the code-paste callback) and they paste the code.

## Measured (11-19, Claude Code 2.1.328, macOS)
In a private tmux server with an empty sandbox config folder and logging stand-ins (no real browser could open):
- BROWSER set: claude called the BROWSER program with the authorize link; `open` was not called.
- BROWSER unset (control): claude called `open`.

## What changes
- `server.js`: the three `connect.start` calls in `/api/connect/start` pass `remoteStarted: isRemoteRequest(req)`.
- `engine/connect.js`: `start()` keeps it on the flow's owner as `noOpener`; the Mac launch (`host.open`) carries it;
  `tmuxLaunchCommand` adds `BROWSER=/usr/bin/true` between `env` and the claude binary when it is set.
- A sign-in started at the computer is unchanged (the browser opening there is the convenience).
- Windows already replaces claude's opener for every sign-in (win32signin.js, withNoOpOpener); nothing changes there.

## Rejected
- No opener for every sign-in, local included: at the computer, the browser opening by itself is what a person
  expects, and the paste path is the fallback, not the main path.
- Deciding in the page: the page cannot be the authority for where the request came from; the server's
  isRemoteRequest is.

## Tests
`engine/connect.test.js`, two arms beside #1937's re-auth test, through the same fake terminal: a remote-started
re-auth's new-session argv has `BROWSER=/usr/bin/true` exactly once, between `env` and the claude binary; the CONTROL,
a local re-auth, has no BROWSER assignment. Both end in `auth login --claudeai`. Mutation: removing the push makes the
remote arm red. engine/connect.test.js and server.connect.test.js: 171 pass, 0 fail.
`server.remoteopener-8728.test.js`: connect.start replaced by a recorder; a request through Kosmos+ (vouching
connector, fresh session headers, so it passes the step-up gate) hands `remoteStarted: true`, and the CONTROL at the
computer hands `false`, for the default re-auth and for a second account.

## Not covered
- Of the three connect.start calls in /api/connect/start, the known-account one (accountDir) has no test; the default
  re-auth and the second account are pinned by server.remoteopener-8728.test.js (below).
- The rest of part 2 (the dialog asking for the fresh sign-in up front and coming back to the same dialog) is later
  slices.
