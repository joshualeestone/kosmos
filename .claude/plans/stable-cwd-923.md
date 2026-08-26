# Blocked install: "the current working directory was deleted" (#923)

Josh, wiping his whole Mac and running a fresh .pkg install, 2026-08-25
~21:25-21:36: reached "Choose a model," pressed Connect for Claude. The
download completes (231MB), then the step fails:

> "Error: the current working directory was deleted so that command
> didn't work. Please cd into a different directory and try again"

Three retries, same result, never got installed. Unblocked by Splinter with
a workaround (Continue anyway, then connect from Settings) before I finished
this trace, so the urgency dropped from "cannot use the product" to "first-run
is broken" -- still fixing it properly, not leaving a live defect just
because the immediate pressure is off.

## Root cause, traced to one line, confirmed by reading the whole chain

`engine/connect.js:801`: `run(downloaded.path, ['install'], { timeout:
180000, env: { TERM: 'dumb' }, cancellable: true })` -- the `<binary>
install` step that runs immediately after a successful download. `run()`
(`engine/connect.js`'s own `execFile` wrapper, line ~137) never sets a
`cwd` option, so the spawned `claude install` process inherits
`process.cwd()` from the RUNNING BOARD -- `server.js` itself never calls
`process.chdir()` anywhere (confirmed: zero occurrences in the whole
`engine/` and `server.js`), so its cwd is whatever directory the shell
chain that originally launched `node server.js` happened to be in.

For the .pkg install path specifically: `install/pkg-scripts/postinstall`
(root, launchd `asuser`, `sudo -u $CONSOLE_USER`) runs `exec curl -fsSL
"$SETUP_URL" | /bin/sh`, which runs `install/setup.sh`, which calls
`"$KOSMOS_HOME/bin/kosmos" start`, which `nohup`s `node server.js` --
**with no explicit `cd` anywhere in that entire chain** (confirmed:
`install/kosmos` never `cd`s before its `nohup ... &` line). The whole
chain's cwd is whatever Installer.app set for the postinstall script's
OWN process -- a temporary, package-script-scoped staging directory
Installer.app tears down once the .pkg's install phase finishes.

The board process is the ONE thing in this chain that OUTLIVES that
directory by design (`nohup`, backgrounded, meant to survive the
installer exiting). Its `process.cwd()` stays pointed at that now-deleted
directory forever, from the moment Installer.app cleans up -- likely
within moments of the .pkg finishing, well before "Choose a model" is
even reached. Any LATER `execFile`/`spawn` call that doesn't override
`cwd` (only `engine/connect.js`'s `run()` fits that description; every
other file write in this codebase resolves through `store.ROOT` or
another absolute path, immune to cwd entirely) inherits the dead
directory, and the spawned child dies at its own startup the moment it
tries to resolve anything relative to a cwd that does not exist -- which
is exactly the shell-level error Josh saw, since it is the shape a
program (or the shell running it) reports when `getcwd()` itself fails.

## Corroborating evidence, independent of Josh's report

Splinter found, the same evening, on the build machine: `node ./server.js`,
ppid 1, cwd deleted (a removed git worktree), still holding a port,
answering HTTP 500 -- the SAME shape from the OTHER direction (there, the
directory went and the process stayed; here, the directory goes and the
NEXT spawned command dies). Not the same code path (that one was a raw
dev `node server.js`, not an installed board), but the same underlying gap:
nothing in `server.js`'s own startup ever pins its `process.cwd()` to
somewhere guaranteed to survive.

## Fix

`process.chdir()` to a KNOWN-STABLE, always-valid directory, as early as
possible in `server.js`'s own startup -- before any route, any spawn, any
later code that might rely on `process.cwd()` implicitly (directly, or
through a child process that inherits it).

**Target: `os.homedir()`, not `KOSMOS_HOME` or `store.ROOT`.** Considered
and rejected both: `KOSMOS_HOME` is guaranteed to exist by the time
`server.js` actually starts (the installer wouldn't have gotten this far
otherwise), and would be the more "on-brand" choice -- but a raw `node
server.js` dev/test invocation (Splinter's own orphan, or this repo's own
test suite) may not have a meaningful `KOSMOS_HOME` set at all.
`store.ROOT` needs `mkdirSync` to actually exist on disk, and while it
gets created very early, `process.chdir()` throws on a directory that
does not yet exist -- a real risk on a machine's first-ever run, exactly
the scenario this card is about. `os.homedir()` is the one target
guaranteed to exist for the entire lifetime of the macOS account running
the process, with no creation step needed and no install-order
dependency. Wrapped in a try/catch matching this codebase's own
defensive style throughout: if even `$HOME` is somehow unreachable, the
board should still attempt to start rather than crash on this specific
line, and the fallback (server.js's own already-existing behavior today)
is simply to run with whatever inherited cwd it had -- no worse than
before this fix, for that one pathological case.

**Does not fix the download-not-resuming complaint (#923's second,
"expensive" defect).** Traced separately: `engine/connect.js`'s own
comment at the `download()` function documents restart-not-resume as a
deliberate, reasoned design choice ("a byte-range resume would hash
clean or dirty the same way, but restart is simpler to reason about and
the file downloads once (measured: 281MB, 9 seconds on this machine's
connection)"). Overriding an existing, reasoned decision is a separate
scope call, not something to fold into a cwd-stability fix -- named here,
not silently absorbed, since 9 seconds on this machine's connection is a
real assumption that clearly did not hold for whatever connection Josh
was on when three retries felt costly enough to report.

**Does not fix the render-collapse (More Models section losing its
styling).** That is Mona Lisa's, tracked separately on the same issue;
she is explicitly staying out of `install/`, no collision here.

## Verification plan

- Direct reproduction: spawn a real `node server.js` from a directory,
  then `rm -rf` that directory out from under the running process (same
  shape as both Josh's and Splinter's real instances), then hit a route
  that calls `engine/connect.js`'s `run()` (or a lower-level unit test
  calling `run()` directly) and confirm it previously would have failed
  and now does not, because `process.cwd()` was already repointed to
  `$HOME` before the deletion could matter.
- A dedicated `server.js` startup test (or `engine/connect.test.js`
  addition) asserting `process.cwd()` is set to `os.homedir()` shortly
  after `require`, without needing the full delete-the-directory dance
  for every test that touches this.
- Full `node --test` suite before merge, to confirm nothing elsewhere in
  this codebase (or its own test suite) assumed `process.cwd()` stayed
  at wherever the test runner itself was invoked from.
