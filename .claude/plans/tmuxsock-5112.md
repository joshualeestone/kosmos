# tmuxsock-5112: a board drops an inherited $TMUX at start

## What
Card #5112: a board sandboxed with its own TMUX_TMPDIR, started from a fleet agent's terminal, inherited $TMUX and
attached to the real fleet's tmux server (tmux prefers $TMUX's socket over TMUX_TMPDIR). It counted 20 real agents on
an empty store and tried to refresh all of them.

Call (the card's option 1): server.js, on the real-start path only, deletes process.env.TMUX before any engine module
that asks tmux anything is loaded (engine/sandbox.js dropInheritedTmux). Every tmux child then resolves its socket from
TMUX_TMPDIR (or the default), the same rule launchd agents follow (create.plistFor carries TMUX_TMPDIR, never $TMUX).

Rejected: option 2 (refuse in the half-sandbox guard). It only refuses, and the walk that found this was a legitimate
sandbox; it would also leave a real board started inside a non-default tmux reading the wrong server. Rejected: an
explicit -S on every tmux call site (about 10 modules spawn tmux); one env fix at the start covers all of them and any
added later.

## Not in this branch
- The kosmos CLI is not changed: it talks to the board over HTTP; an agent's TMUX_PANE is how `kosmos send` knows its
  sender, and TMUX_PANE is kept here too (it names a pane, not a server).
- The routing tests require server.js; the drop is gated on require.main, so the test runner's own $TMUX is untouched.

## Proof
- engine/sandbox.test.js: the function; two PRIVATE tmux servers under /tmp (never the machine's), control arm shows
  the inherited $TMUX wins (the bug), fix arm shows TMUX_TMPDIR's server answers; source order (drop before
  engine/status). 14/14 with server.worldenv-order. Mutants: delete line removed -> 2 red; server.js call removed -> 1 red.

## Weakest premise
That on a standard machine dropping $TMUX lands on the same server. tmux falls back to TMUX_TMPDIR or /tmp, resolved
through realpath, which is where the fleet's $TMUX points (/private/tmp/tmux-501/default). Measured only on private
servers: a probe against the fleet's own server was refused by the permission check, correctly. If a person runs their
real board inside a tmux on a non-default socket (-L/-S), the board now reads the default socket, which is where its
launchd agents are; before, it read their private one and saw none of its agents.
