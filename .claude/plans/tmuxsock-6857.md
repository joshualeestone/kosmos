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

## Review 5 (Opus): one medium, four low; all fixed with controls (51 now)
- -L does fall back: it names a socket in the same TMUX_TMPDIR folder, so with the folder gone it is
  /tmp/tmux-<uid>/<name>, and `-L default` IS the machine's server. Header corrected; `-L default` refused in all
  three shapes. The repo's -L calls are safe because every label is unique per process.
- Shape 1 now needs '-S'/'-L' as a whole first element, and the array used as it is (only ',' or ')' after its ']').
- Shape 3 refuses a backslash (an escape could hide a second command).
- A listed wrapper: every definition must start with -S/-L; a plain call only in the wrapper's own file; obj.name(...)
  only when obj is required from the wrapper's file. (Round 4 had dropped round 3's every-definition rule silently.)
- Controls added for the arms that had none: not in an array, holder depth, regex class, escaped quote, per-file
  WRAPPERS keying.

## Review 6 (Sonnet): one high, four lower; all fixed (64 controls)
- Shape 3's name was \S+, which also took shell operators with no spaces (`tmux -L a;tmux kill-server`) and quotes
  (`-L "default"`). Shape 3 is now only the form the repo uses: [tmux|${}] -S|-L <name of [\w./-] or ${}> kill-server,
  and the name is never default in any case.
- Shape 1: no -L anywhere in the array may name default (tmux takes the last -L), compared without case.
- A listed wrapper is read only inside its own definition (it took the next statement's array), and a name also made
  another way (reassigned, or a method of that name) is refused.
- obj.name(...): every `obj = ...` in the file must be the require from the wrapper's file.
- Escapes are read before matching (kill\x2dserver), and the per-file prefilter is /kill/i.
- Found while fixing: a function wrapper's walk started past its '(' again (same slip as round 2), and the -L default
  scan compared against the comma. Both fixed and covered by controls.

## Review 7 (Opus): 6 fail-open, 2 fail-safe. Decided the guard's SCOPE, then fixed what is in it (76 controls)
Call: the guard is a tripwire for what an author writes BY MISTAKE, not a defence against code written to get past
it. Most of round 7 was deliberate obfuscation (identity/octal escapes, a line continuation, code inside ${}, -L
./default, a shadowing parameter, a slice inside a helper). No source reader can close that set, and chasing it is why
seven rounds have not converged. Those are now listed as limits in the header.
Rejected: closing each obfuscation (an eighth round finds an eighth); replacing the guard with a runtime check
(tmux's own fallback is the bug, and the three fixed sites are the runtime fix).
Weakest premise: that authors here make mistakes rather than write evasions. They are agents writing tests; an
agent copying an old bare `['kill-server']` is the realistic case, and that is caught.
Fixed (in scope):
- An array handed to a listed wrapper is read too: -L default (or -S the machine path) there is flagged.
- -S written as the machine's own path, /tmp/tmux-<uid>/default (or under /private), is refused in shapes 1 and 3.
- Shape 3 captures its flag, so the default check knows -S from -L; the unreachable backslash clause is gone.
- Controls for the five arms round 7 showed untested: a function wrapper's end, a non-require reassignment, a
  wrapper defined nowhere, an array that is not a direct argument, \u and \u{} escapes.
Fail-safe, left: a destructured require of a listed wrapper is refused (none in the repo).

## Review 8 (Sonnet, scoped): one realistic accident, control gaps; fixed (85 controls)
- In scope and real: an author copying status.js's `path.join(process.env.TMUX_TMPDIR || '/tmp', 'tmux-' + uid,
  'default')` into a kill passed, and with TMUX_TMPDIR unset that is the machine's server. The whole value after -S
  is now read: a '/tmp' folder, a '/tmp/tmux-' path (by +, template or join) or process.env.TMUX_TMPDIR is refused.
  A socket of its own is built from a folder of its own (the three fixed sites pass a mkdtemp variable).
- The escaped-quote control could not fail; now it carries a bare kill that only an early-ending string would expose.
- Controls added: a multi-line block comment, a regex cut by a new line (line count), the machine path in any case,
  spaces around a one-command string.
- Fail-safe, left: `|| true`, `2>/dev/null`, `-f /dev/null` before -L, and prose kill-server strings are flagged.

## Review 9 (Opus, scoped): one realistic accident, three lower; fixed (101 controls, counted)
- In scope and real: sandbox.test.js builds its socket path into a const, then passes ['-S', sock, 'kill-server'].
  A copied status.js builder inside that const passed. The -S value is now traced through plain variables, three
  levels deep, and the same refusals apply to everything it is built from. os.tmpdir() joined with 'tmux-...' and no
  mkdtemp is refused too (Linux with TMPDIR unset is /tmp).
- Narrowed: a '/tmp' folder is refused only when joined with 'tmux-...'; only process.env.TMUX_TMPDIR, not a local
  env object, is refused.
- A refusal for the machine's own server now says so, instead of "not a listed wrapper".
- Controls for the six arms with none (env, /private in shape 3, a call not an array, a non-require reassignment, an
  object never required, WRAPPERS keyed by file) and regexOk's name arm. Three new arms mutated: each control red.
- Header: a path more than three variables away, or through a parameter, is a stated limit.

## Review 10 (Sonnet, scoped): my round-9 trace overreached; replaced by one rule that GRANTS (111 controls, counted)
- Round 9's trace read every same-named declaration in the file (one test's const condemned or vouched for another's),
  and its five refusal rules missed $TMUX (inside an agent's pane that IS the machine's server) while refusing two
  ordinary private sockets. Same lesson as round 4: each refusal rule opens a new edge.
- Now -S is accepted only when its value is built from a folder made by mkdtemp, in the value or the NEAREST
  declaration before it of each variable, three levels deep. All three fixed sites do exactly that. It closes
  TMUX_TMPDIR, $TMUX, /tmp and os.tmpdir() without listing them. A fixed path is refused even when private
  (fail-safe; make the folder with mkdtemp). -L: refused only for 'default', direct or as the nearest value.
- Stated limits added: tracing is by position, not scope (a nearer declaration in a closed block is read; refuses,
  never passes); a property named mkdtemp is read as the call.
- Mutants: the rule off, depth 2, first-not-nearest declaration: each turns its controls red.
- The plan's "101 controls" earlier was a miscount of a different grep; this count is the controls file's own.

## Review 11 (Opus, scoped): the redesign. -S kills go through ONE runtime helper; the guard stops inferring paths
Round 11 found two more realistic -S accidents (an env object whose mkdtemp field vouched for an inherited
TMUX_TMPDIR; a command string whose ${sock} was never traced) and that the header's "refuses, never passes" was false.
Eleven rounds of deciding from SOURCE whether an -S path could be the machine's own server kept finding new ways it
could. That question has a run-time answer, so it moved there:
- test-support/tmux-kill.js killServerAt(bin, sockPath, opts): throws for /tmp/tmux-<uid>/default (through any
  symlink) and for $TMUX's socket (read at load and at the call); returns null and runs nothing when there is no socket
  at the path (the card's own "guard the kill on the socket existing"); otherwise `tmux -S <path> kill-server`.
  Tested with a fake tmux that records its arguments (engine/tmux-kill-helper-6857.test.js, 5 tests), so no real
  server is started or ended.
- The three sites (live-connect, last-look, sandbox x2) call killServerAt.
- The guard: a 'kill-server' in an array holding '-S' is refused outside the helper and its test. Everything else
  must be a named -L (shape 1, a listed -L wrapper, or one "[tmux] -L <name> kill-server" string), never -L default.
  The mkdtemp rule, the variable tracing and the /tmp/env refusals are gone.
- The repo test also asserts the three sites still call killServerAt (HELPER_USERS), and names a bad kill before that.
Rejected: another round of path rules (eleven rounds show the edge never closes from source).
Weakest premise: that the machine's server is /tmp/tmux-<uid>/default or $TMUX's socket. A server started with its own
-S elsewhere is not "the machine's" in this sense; the fleet's is the default one (measured on #6851).
Controls: counted in the file. Against origin/main's three files: red, naming all four calls.

## Review 12 (Sonnet): three low findings on the redesign; fixed
- killServerAt compared spellings: /tmp/tmux-501/DEFAULT (case-insensitive volume) or a symlink to the machine socket
  passed. It now also compares the file itself (device and inode) for a socket that exists.
- The default socket under TMUX_TMPDIR is now treated as the machine's, but ONLY as TMUX_TMPDIR was when the module
  loaded. Caught before running: two of the three sites set TMUX_TMPDIR to their own folder (live-connect after it
  requires the helper; last-look in opts.env), so a call-time read would have refused the very server being ended.
  A test pins that case (it is the regression I nearly shipped).
- Guard: the -L variable follow check is gone (it only exempted `n + ''`); controls for a wrapper's -S after its -L
  and for a -L name built on a default variable.
- Mutants on the helper (identity check off, load-time TMUX_TMPDIR off, call-time TMUX_TMPDIR on, existence check off):
  each fails a helper test. Helper tests 8, guard tests 2, all pass.

## Review 13 (Opus): helper and sites correct; two test gaps, fixed
- No test could fail for the load-time $TMUX read (live-connect deletes $TMUX after loading the helper, so that read is
  its only $TMUX protection). New child-process test: $TMUX set at load, deleted before the call, refused; control:
  $TMUX naming something else, the same file is ended.
- The /tmp/tmux-<uid>/default test passed without that check inside an agent's pane ($TMUX names the same socket).
  It now runs in a child with TMUX, TMUX_PANE and TMUX_TMPDIR removed.
- Both mutants that survived round 13 now fail a test. Helper tests 9, all pass.
- Noted, not changed: with the identity check, the folder-symlink resolution in real() no longer changes an outcome
  (a missing socket runs nothing anyway). Kept: it is what makes the refusal hold for a socket that does not exist yet.
