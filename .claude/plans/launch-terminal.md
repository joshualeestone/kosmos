# Plan: #2129 companion -- Launch-Terminal route

## Problem

The Kosmos board reads an agent by CAPTURING its tmux pane; it never attaches.
So a person who wants the live session in front of them -- to answer a runner
prompt the board cannot (the #2129 trust menu is the motivating case), or just
to watch -- has no way in from the app.

## Goal

A one-click "Open Terminal": given a live agent, open a real Terminal.app window
attached to its tmux session, so the person can see and interact with the actual
session. It is the companion to the trust-and-restart fallback (one is a fix,
this is a window).

## Design

New engine module `engine/terminal.js` + route `POST /api/agent/:name/launch-terminal`:

1. Resolve the agent's live session via `status.paneRoster()` -- the SAME
   resolver `removal.restart` uses. Refuse a not-running agent (no card / no
   session) and an unconfirmable one (`isNamedOurs !== true`), with the same
   friendly refusals remove.js gives.
2. Open Terminal.app attached to the session, via `osascript` telling Terminal
   to `do script "exec <tmux> attach -t <session>"`, through the module's OWN
   runner seam (`terminal.setRunner`, mirroring `create.setRunner`) so tests
   never open a window.

READ-ONLY about the agent: tmux allows many clients and the board reads by
capture (not a client), so this only ADDS a viewer -- it never restarts the
agent or touches the session.

## Security

Both the session name and the tmux binary path cross into a shell command
inside an AppleScript. Defenses:
- `SAFE_SESSION` (`^[A-Za-z0-9][A-Za-z0-9_-]*$`) refuses any session name that
  is not plain alnum/_-/ before it is embedded. A `<NAME_RE>-discord` session
  is always safe; a `@kosmos_agent`-claimed session with an unusual name is
  refused rather than shell-quoted (the safe direction).
- Every value is shell-single-quoted, then the whole command is AppleScript
  string-escaped (backslash before double-quote, so a shell-escape backslash
  survives). `tmuxBin` has no allowlist and relies solely on this quoting.
- Auth inherited by construction: not in REMOTE_AGENT_ROUTES (network peers
  refused), board-token gated as an /api/ write, CSRF-covered.

## Status codes

- 200 `{ok:true, session}` on success.
- 400 `{ok:false, because}` for a genuine refusal (not running / not ours /
  unsafe name).
- 503 `{ok:false, because}` for an ENVIRONMENT failure (tmux unaskable, or
  osascript failing on a headless board) -- marked `unavailable` so a transient
  does not read to monitoring as a client error. It needs a GUI session to
  succeed (the app machine); on a headless board it returns the 503 refusal
  rather than throwing.

## Out of scope (routed)

The View-Agent "Open Terminal" button (web/index.html, Angel's lane). Routed to
Angel with the exact route contract; copy from Mona Lisa. Rides 0.6.44.

## Test strategy

`server.launch-terminal-2129.test.js`: the HTTP route opens Terminal for a live
agent with a shell-quoted attach command; a stopped agent is a 400 with no
osascript; an osascript/headless failure is a 503; a hostile session (a real
fleet row with its session overridden) is refused by SAFE_SESSION with no
osascript; paneRoster throwing fails closed (503); and the two quoting helpers
are unit-tested directly against adversarial input incl. the composition. The
two security guards (SAFE_SESSION, shell/AppleScript quoting) are each verified
red under a matching perturbation.

## Decisions

- Resolve via paneRoster (the existing resolver), not a new session lookup.
- Own runner seam in terminal.js (idiomatic here) rather than reusing create's.
- Environment failures are 503, not 400 -- a transient/headless failure is not
  a bad request.
- Keep SAFE_SESSION even though paneRoster makes it practically unreachable: a
  value crossing into a shell is validated, not trusted.
