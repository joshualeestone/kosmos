# tmuxsock-6857: every kill-server names its socket

Card: #6857. Done when: no kill-server in the repo's JavaScript can reach the machine's default tmux server, and a
test fails if one is added.

## Calls
- Fix: `-S <dir>/tmux-<uid>/default` on the three calls the card names (live-connect exit handler, last-look healthy
  test, sandbox #5112 test x2). -S never falls back, so no existence guard is needed: a missing socket is "no
  server running", which every site already tolerates.
- Guard: engine/tmux-kill-socket-6857.test.js reads every .js/.cjs/.mjs (not node_modules/.git/.claude), finds a
  quoted 'kill-server' argument, and passes it only with a quoted -S/-L before it on the line or in the wrapper it is
  handed to (same file, or `mod.fn` via `mod = require('./x')`). It found three more wrapped calls, all already
  -L: sessionccd-6095, tmuxsignin (runTmux), provider-key-inject-3296.
- Count floor (>= 9) so a walk that reads nothing cannot pass clean.

## Rejected
- Shell scripts in the guard: tools/test-linux-systemd-live-4918.sh is #6852's (PR #6853, open); guarding it here
  would turn main red if this merges first.
- kill-session in the guard: product code kills fleet sessions on purpose; whether a call is under TMUX_TMPDIR is not
  visible statically.

## Weakest premise
The guard is textual: a kill-server built from a variable (`const v = 'kill-server'`) or split across lines is not
seen. None exists today.

## Review 1 (Opus): three holes in the guard, all fixed with a control each
- A kill-server inside a command string ('tmux kill-server', a template) was never read: now flagged unless that
  same string says -S or -L. A command assembled across several strings is flagged even if it names a socket
  (safe direction; write it as one string or as arguments).
- The wrapper lookup took the first same-named definition plus three lines, so an unrelated `run` with -L, a -L in
  a comment, or a -L after the wrapper's end vouched for it. Now: comments stripped, the nearest definition before
  the call, and only that statement (to its closing bracket).
- Another call's -S on the same line (capture-pane -S -200) counted. Now only the enclosing call's arguments.
- The count floor counts command strings too. Control re-run against main's three files (checked out from
  origin/main, not stashed: committed files do not stash): red on all four calls.
