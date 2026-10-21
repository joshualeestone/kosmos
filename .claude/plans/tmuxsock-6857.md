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

## Review 2 (Sonnet): the text scan could not tell code from strings, comments and regexes; replaced by a lexer
- A glob ('engine/*.test.js') or a regex (/\/*$/) opened a "comment" that hid real code; ' //' in a string ate the
  line; a brace-less arrow with no semicolon ran into the next statement; brackets in strings moved the depth; another
  command's -L in the same command string vouched; the whole-repo count was padded by a regex literal and an expected
  string.
- Now: a small tokenizer (strings, templates with ${...} read as code through a brace stack, comments, regex literals
  by the previous token). Calls, wrappers and depth are read over tokens; a command string is split at ; && || | and
  new lines and only kill-server's own command must name the socket; an arrow ends at a new line at depth 0 unless the
  line continues the expression; the count floor is per file (EXPECTED), so a file the lexer stops reading fails.
- Found while building it: a regex holding a backtick inside a template's ${...} swallowed 12,203 characters of
  sessionccd-6095 (the per-file floor caught it); and function definitions started one token past '(' (runTmux's
  -L was missed). Both fixed.
- Limits stated in the header: a name split across strings, a flag built at run time, a -L that is only a default
  parameter's value.
- Controls: 26 (each round-1 and round-2 shape red, its twin green). Against origin/main's three files: red on all four.

## Review 3 (Opus): five fail-open shapes, a lexer gap, three fail-safe misreports; all fixed
- The rule is now stricter rather than patched: a 'kill-server' must sit directly in an array or a call. The walk
  back stops at any '{' and ';' (a callback's earlier -S vouched for a kill in a variable). An array held in a
  variable is flagged: nothing can see which call gets it. Only the arguments after the last ';' element count
  (capture-pane -S -50 before ';'). A '?' among them means the socket is only sometimes there: flagged.
- Every definition of a wrapper must name the socket (a helper per test: which one a call reaches is scope this does
  not model); for mod.fn, every definition in the required file.
- Every kill-server in a command string is checked, not only the first.
- Lexer: n++ / 2 divides; '||' '&&' '??' '++' '--' are single tokens (the arrow-end rule now sees them); a regex cut
  short by a new line leaves that line counted (line numbers drifted after a hashbang).
- A file listed in EXPECTED that is gone says so.
- Not fixed, stated: `if (x) /re/` (a regex after an if's ')') is read as division. Not in the repo.
- Controls: 34. Against origin/main's three files: red on all four.

## Review 4 (Sonnet): more ways to fool an inference; the guard is now a SHAPE rule instead
Four rounds each found new code that a "does this name a socket" inference got wrong (a conditional socket in a
wrapper, another call's -S inside a wrapper, separators the command split missed, an earlier argument's -S, -S as
data, tmux's shortened spellings). Patching each was not converging, so the rule changed from inference to shape.
A kill-server is accepted only as:
  1. an element of an array literal whose first element is '-S' or '-L'
  2. an element of an array handed straight to a wrapper listed in WRAPPERS (by calling file), whose definition's
     first array literal starts with '-S' or '-L' with no '?' before it
  3. inside a string, only as one whole command "[tmux] -S|-L <name> kill-server"
Everything else fails, including kill-ser / kill-serv (tmux takes unique prefixes). A new wrapper fails until it is
listed, so a person reads it. Every real call in the repo already has one of these shapes; no repo file changes.
Rejected: keeping the inference and patching round 4's cases (a fifth round would find a fifth shape).
Weakest premise: a listed wrapper is trusted from its first array; a wrapper that builds that array and then drops
it would pass. Three wrappers today, each read.
Controls: 35 (each failing shape from rounds 1 to 4 red, each accepted shape green). Against origin/main's three
files: red on all four.
