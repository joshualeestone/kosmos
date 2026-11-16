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
- The board is NOT guarded. install/kosmos's two board starts load the preload too (it is in NODE_OPTIONS); it
  restores the environment and, seeing its entry is server.js, installs nothing. So the board's behaviour on a closed
  stdout is exactly what it was. Review rounds 1 to 4 each raised the board (silent exit, restart status, no log
  line); exempting it ends that question rather than defending a change nobody asked for. Tested both ways
  (engine/clipipe.test.js: an entry named server.js keeps the EPIPE trace; another entry exits 141).
- No change to the node steps' `||` fallbacks. Reviews 1 and 3 had me add a 141 arm to nine of them, on my premise
  that agents run the wrapper with SIGPIPE ignored. That premise was FALSE, measured in an agent's own Bash tool:
  `yes | head -1` exits 141 and so does a bash child (SIGPIPE at its default; libuv resets it for children). With the
  default, a fallback's `say` (stdout) into the closed pipe kills the wrapper silently with 141, so those sites were
  already quiet. Review 5 then found the arms untested and one sibling missed; all nine were reverted, leaving
  install/kosmos as main plus the preload block. Weakest premise: a caller that does ignore SIGPIPE would see a false
  "could not read" line there, as on main (not this card's trace; none found).
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
### Review 4 (sonnet): 2 WARNINGs fixed, 4 NITs (2 fixed, 2 left)
- WARNING fixed: the board is exempt from the guard (Decisions), so its exit status and log are unchanged; a test
  covers both arms, red when the board check is forced off.
- WARNING fixed: the preload is added only when the file is readable (`-r`), not only present.
- NITs fixed: clipipe.js says a node started by the wrapper's non-node children restores the env too; the long
  install/kosmos comment line is rewrapped.
- NITs left: the test arm 1 exit code (arm 3 covers it); the Windows entry check reads source (measured on Windows).
### Review 5 (opus): 2 WARNINGs resolved by reverting, 4 NITs (2 fixed, 2 left)
- WARNINGs (the nine fallback arms are untested; the role-text sibling was missed): measured that the premise behind
  the arms was false (SIGPIPE is not ignored in agent shells) and reverted all nine; see Decisions.
- NIT fixed: install/kosmos says the preload covers the installed layout (app/engine) only.
- NIT fixed: clipipe.js says only EPIPE was measured (Mac, Linux CI, Windows Git Bash).
- NITs left: the system-node fallback's NODE_OPTIONS quote parsing (Node has parsed quoted NODE_OPTIONS since v12;
  the bundled runtime is 22); isBoard matches any server.js entry among the preload's inheritors (only the
  wrapper's own children, whose only server.js is the board).
