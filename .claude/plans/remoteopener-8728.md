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
- `claude auth login --claudeai` (the re-auth launch): BROWSER set, claude called the BROWSER program with the
  authorize link and `open` was not called; BROWSER unset (control), claude called `open`.
- A bare first-run `claude` (the other launch this file makes; review 1), driven through its first screens with Enter:
  the same, BROWSER program with BROWSER set, `open` without.
- In all four arms the stand-in exited 0 (as /usr/bin/true does) and the pane still printed the link and reached
  "Paste code here if prompted", which is what the remote person uses.

## What changes
- `server.js`: the three `connect.start` calls in `/api/connect/start` pass `remoteStarted: isRemoteRequest(req)`.
- `engine/connect.js`: `start()` keeps it on the flow's owner as `noOpener`; the Mac launch (`host.open`) carries it;
  `tmuxLaunchCommand` adds `BROWSER=/usr/bin/true` between `env` and the claude binary when it is set. Every state
  write of such a flow carries `noOpener: true`, and `publicView` serves it (review 3).
- `web/index.html` (review 3): one question, `signinOpensNoBrowserHere(st)`, true on a cloud machine or for a
  remote-started flow. Settings' link row (`acctClaudePaintUrl`) and the wording (`signinSay`, both screens) read it,
  so a remote person on a Mac is shown the sign-in link and told to open it, never "the browser window that just
  opened". Before review 3 the row was cloud-only, so the slice removed the wrong-screen browser and left no link.
  Review 4: the first-run screen (`frPaintConnect`, `frConnPaintUrl`) reads the same question, so a remote start on a
  Mac gets the link as the primary button and never "Your browser has opened"; frConnPaintUrl's no-repaint stamp
  includes the answer. `writeState` sets the flag from the owning flow on every write (and removes one a caller's
  spread carried in).
- A sign-in started at the computer is unchanged (the browser opening there is the convenience).
- Windows (review 5): the flag is never set there. That host replaces claude's opener but then opens the sign-in page
  ITSELF (win32signin.js, openSigninPageOnce, with a localhost callback), so a remote start on Windows still opens a
  tab on the computer. Not setting the flag keeps the page's words true there ("your browser has opened"). Making
  Windows skip its own open for a remote start is the Windows owner's change, filed separately.
- The opener is `/usr/bin/true`, or `/bin/true` where only that exists (a Linux without a merged /usr; review 2).
  Measured on macOS only.

## Rejected
- No opener for every sign-in, local included: at the computer, the browser opening by itself is what a person
  expects, and the paste path is the fallback, not the main path.
- Deciding in the page: the page cannot be the authority for where the request came from; the server's
  isRemoteRequest is.

## Tests
`engine/connect.test.js`, two arms beside #1937's re-auth test, through the same fake terminal: a remote-started
re-auth's new-session argv has `BROWSER=/usr/bin/true` exactly once, between `env` and the claude binary; the CONTROL,
a local re-auth, has no BROWSER assignment. Both end in `auth login --claudeai`. Mutation: removing the push makes the
remote arm red. Review 1: a third arm, a remote-started first run (bare claude, no auth login), gets the same
assignment right before the binary. engine/connect.test.js and server.connect.test.js: 171 pass, 0 fail.
Review 3: the engine arms also assert `state().noOpener` (true remote, false local); `web.flowpoll-4275.test.js` has a
remote Mac Settings arm (link shown, "Open the Claude sign-in page below", never "just opened") with a local CONTROL
(no row, no open-it words), through a new `words` harness option that lifts the wording without the cloud stub.
Review 4: `server.connect.test.js` has a first-run arm for a remote start on a Mac (primary link, no "opened" or "did
not open" words) with a local CONTROL (Mac words, fallback link); its harness always lifts the helper and gains a
`words` option. docs/browser-checks/render-cloud-signin-4903.js (keyed on frConnPaintUrl) ran 50/50 and carries a
Browser-check-surface trailer.
`server.remoteopener-8728.test.js`: connect.start replaced by a recorder; a request through Kosmos+ (vouching
connector, fresh session headers, so it passes the step-up gate) hands `remoteStarted: true`, and the CONTROL at the
computer hands `false`, for the default re-auth, a second account and (review 5) a known account (accountDir, a
sandbox .claude-<label> folder whose config names its oauth account). Review 5 engine arms: a local start after a
cancelled remote one carries no flag and no BROWSER; on Windows a remote start does not set the flag. Mutations, each red:
dropping remoteStarted from the accountDir call (2), setting the flag on Windows (1). NOT pinned: writeState's
`else delete mem.noOpener` (removing it leaves every test green, because only a caller spreading an earlier state
into a write would carry the flag in, and no test path does that); it stays as a guard on that spread.

## Not covered
- If neither /usr/bin/true nor /bin/true exists, the opener names /usr/bin/true anyway and what claude does with a
  program it cannot run is unmeasured. Every macOS has /usr/bin/true, and a Linux with coreutils or busybox has one of
  the two, so this is not reached on any system Kosmos runs on today.
- A start while a sign-in is already running attaches to that flow with that flow's setting: a remote start that
  lands on one begun at the computer finds a browser tab already open there (opened by the local press, not by this
  change), and a local press that lands on a remote-started one gets no tab and uses the paste link.
- The rest of part 2 (the dialog asking for the fresh sign-in up front and coming back to the same dialog) is later
  slices.
