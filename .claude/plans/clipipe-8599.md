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
  exits quietly instead of crashing with a trace; its stdout is the board log file in normal use. Either way it ends;
  the supervisor (launchd, systemd) restarts it as before, and only the trace in the log is gone. (Windows boards
  keep their own design, #8373/#8424: a closed console copy is recorded and never ends the board; untouched.)
- Eight node steps in install/kosmos that print to the person's stdout and have a fallback (connections list, what
  agents found, accounts, task list, task log, project list/show, agent list, roles list) pass 141 straight through.
  Found by reading every "could not read"/"did not run" sayer that follows a node step printing to stdout; the rest
  answer an HTTP body or read a `$(...)` capture, which cannot see the person's reader. It matters when the wrapper
  runs with SIGPIPE ignored, which is how agents run it (Claude Code's Bash tool is a node child, and node ignores
  SIGPIPE): there a `say` into the closed pipe printed "write error" and exited 1. Under a plain shell `say` is
  killed by SIGPIPE first, so those sites were already quiet.
- A board that dies on a closed stdout leaves no line (accepted: a stderr line on stdout EPIPE would print on every
  CLI `| head`, the noise this card removes; the board's stdout is its log file in normal use).
- Exit 141 rather than 0: what a shell reports for a program a closed pipe stopped (git, cat). `| head` without
  pipefail is unchanged; with pipefail it was already non-zero (the crash exited 1).
- A KOSMOS_HOME that is relative or holds `"` or `\` gets no guard (runs as before), since NODE_OPTIONS would read it
  wrong and every node would fail. Spaces are quoted and work (test arm 5). A relative KOSMOS_HOME already fails on
  main (the verbs' own require of "$KOSMOS_HOME/app/engine/..." resolves as a module name, measured), so that skip is
  defensive only and has no test arm.
- Accepted residual: a `kosmos` running while an update swaps app/ can start a node the instant clipipe.js is absent;
  that node fails loudly ("Cannot find module") and a rerun works. Weakest premise: that no long-lived `kosmos`
  process keeps starting nodes across an update (none found; reasoned, not measured).

## Validation
- Real repro on Agent1s, real pulled reports: installed 0.8.06 17 stderr lines / 2 EPIPE; this branch 1 line / 0;
  this branch with the guard off 17 / 2. Full output 498764 bytes either way.
- Mutant: install/kosmos from origin/main with this branch's tests: test-cli-epipe-8599.sh FAILS (the trace).
- Windows, measured 2026-11-16 17:33 on the Windows test box (Server 2022, Node 22.12, Git Bash `| head -1`, 1 MB
  write, this branch's clipipe.js): guarded rc 141, 0 stderr lines; unguarded control rc 1, 25 lines, 2 EPIPE (the
  same unhandled 'error' trace). Windows reports the closed pipe as EPIPE, the code the guard handles. The CLI entry
  block's install() call is checked by source (engine/clipipe.test.js), not run there.
- Guards: engine.reachable, windows-coupling-audit-1732, windows-tests-1777, fixture-discipline, every-test-runs,
  orgpolicy-names-6233: all pass.

## Review log
### Review 1 (opus): 3 WARNINGs fixed, 1 deferred, 4 NITs (3 fixed, 1 left)
- WARNING fixed: a preload path that NODE_OPTIONS or node would misread (relative, `"`, `\`) now gets no guard; a
  space is tested (arm 5).
- WARNING fixed: four `||` fallbacks no longer turn a closed reader (141) into a false "could not read" line or a
  reprint into the closed pipe.
- WARNING fixed by decision: the update-swap window is an accepted residual, stated in install/kosmos and here.
- WARNING deferred to the closing gate: a full suite with the preload active (queued; one suite per Mac).
- NITs fixed: the clipipe header's wording and node count; the board-exit note (Windows design untouched).
- NIT left: the Windows check reads the entry block's text; the zip copies every non-test engine/*.js
  (tools/build-kosmos-windows.sh), so engineDir() holds clipipe.js. A Windows run is on the card's checklist.
### Review 2 (sonnet): 2 WARNINGs answered by measurement, 1 fixed by measurement, 2 NITs fixed
- WARNINGs (one root cause): the wrapper's non-node children carry NODE_OPTIONS and the marker. Measured: install/kosmos
  starts no tmux server (its tmux calls are ls, list-*, display-message, capture-pane) and the board restores both
  before it starts agents; now stated in the install/kosmos comment. Setting it per node site was rejected (Decisions).
- WARNING fixed: Windows measured on the test box (Validation above), not only reasoned.
- NITs fixed: clipipe.js says the exit is immediate and what it means for a board; install/kosmos says what
  KOSMOS_USER_NODE_OPTIONS_SET holds.
### Review 3 (opus): 1 WARNING fixed, 1 deferred, 1 accepted, 1 CONVENTION fixed, 3 NITs (2 fixed, 1 left)
- WARNING fixed: four more node-step fallbacks (accounts, what agents found, project list/show, agent list) pass 141;
  Decisions says when the arm matters.
- WARNING deferred to the closing gate: the full suite with the preload active.
- WARNING accepted: the board's silent exit on a closed stdout (Decisions).
- CONVENTION fixed: the Windows comment names only the measured case (Git Bash head -1).
- NITs fixed: the test header's arm count; the install/kosmos comment names the system-node fallback.
- NIT left: the Windows entry check reads source (review 1's NIT; measured behaviour is under Validation).
