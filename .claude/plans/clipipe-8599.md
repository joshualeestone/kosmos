# kosmos#8599: a closed reader ends a kosmos command quietly, not with an EPIPE trace

## Done looks like
`kosmos feedback triage 2>err.txt | head -1` leaves only the verb's own note on stderr (no `Error: write EPIPE`, no
`Unhandled 'error' event`), for every verb of the Mac/Linux CLI and the Windows CLI, and the full output still prints
in full when nothing closes early.

## Built
- engine/clipipe.js: `install(proc)` gives stdout and stderr one 'error' listener: EPIPE exits 141 (128 + SIGPIPE),
  anything else is thrown again. Loaded as a preload with `KOSMOS_CLIPIPE_SET=1`, it first restores NODE_OPTIONS to
  the person's own value (or unsets it) and drops the markers, so nothing a CLI node child starts inherits it.
- install/kosmos: right after NODE/APP, when app/engine/clipipe.js exists and no outer kosmos already did it, saves
  the person's NODE_OPTIONS and appends `--require "<clipipe.js>"`. One place covers all ~125 node children.
- tools/windows/kosmos-cli.js: the entry block installs the guard before main() (one node program, no preload);
  an older engine without the file runs as before.
- Tests: engine/clipipe.test.js (guarded exit 141 + an unguarded CONTROL showing the trace; the preload restores the
  env; restoreNodeOptions cases; a non-EPIPE error is rethrown; the Windows entry installs before main());
  tools/test-cli-epipe-8599.sh (the REAL install/kosmos and clipipe.js with a fake 1 MB triage engine: guarded run
  quiet, guard-off CONTROL shows EPIPE, full output 20000 lines and rc 0, a child of the CLI's node sees only the
  person's NODE_OPTIONS). Registered in package.json test:shell.

## Decisions
- One preload through NODE_OPTIONS, not ~125 site edits and not a shell shim (a shim needs three build scripts to ship
  it; engine/*.js ship already). Rejected: exporting NODE_OPTIONS and leaving it (it would reach the board, every
  agent and Claude Code itself, and a missing file would stop all of them starting). The preload removes itself on
  load, and is added only when the file exists.
- The two board starts (install/kosmos `nohup "$NODE" "$APP"` and the `exec` foreground start) also load it, then
  restore NODE_OPTIONS before the board starts anything. Effect on the board: a board whose own stdout pipe closes
  exits quietly instead of crashing with a trace; its stdout is the board log file in normal use.
- Exit 141 rather than 0: what a shell reports for a program a closed pipe stopped (git, cat). `| head` without
  pipefail is unchanged; with pipefail it was already non-zero (the crash exited 1).
- Weakest premise: NODE_OPTIONS quoting of a KOSMOS_HOME with a double quote in it. A space is quoted; a `"` in the
  install path would break every CLI node start. Install paths are ~/.local/share/kosmos (a home folder name with a
  `"` is the only way in).

## Validation
- Real repro on Agent1s, real pulled reports: installed 0.8.06 17 stderr lines / 2 EPIPE; this branch 1 line / 0;
  this branch with the guard off 17 / 2. Full output 498764 bytes either way.
- Mutant: install/kosmos from origin/main with this branch's tests: test-cli-epipe-8599.sh FAILS (the trace).
- Guards: engine.reachable, windows-coupling-audit-1732, windows-tests-1777, fixture-discipline, every-test-runs,
  orgpolicy-names-6233: all pass.

## Review log
