# agentbrowser-mac-3633: every Mac Claude agent gets its own private browser

Card: kosmos#3633, the Mac half of #3629 (Windows, merged). Josh chose option 2 on
2026-09-24 at 14:07 CDT: every agent gets its own private browser by default.

## Decision: Playwright's own chrome-headless-shell, pinned, never the person's Chrome
- The same Playwright MCP 0.0.82 tree that #3629 pins, and the same `ensureInstalled`,
  which runs unchanged on macOS (2.9s, measured in a sandbox).
- The browser is `chrome-headless-shell` 154.0.8037.0, the build the pinned playwright-core
  asks for (`install --dry-run`). Kosmos downloads it once from cdn.playwright.dev and checks
  a sha256 and exact byte size pinned per Mac CPU (arm64 99,415,613 bytes, x64 104,347,883,
  both measured 2026-09-24). It is
  unpacked with `ditto`, proved with `--version`, and swapped in whole: the same order as the
  server tree.
- The config passes `--browser chromium --executable-path <shell> --headless --isolated`.
  `--browser chromium` alone asks for the full Chrome for Testing, which is not installed
  (measured: "Browser chrome-for-testing is not installed").
- Rejected: the person's installed Chrome (`--browser chrome`). Not every Mac has it, it
  updates itself and can drift from the pinned Playwright, and it launches an app the person
  owns. Kayak bot-walled it exactly like the shell, so it bought nothing there.

## Wiring
- engine/agentbrowser.js: `SHELL` pin, `ensureShell`, `shellInstalled`, Mac arm of
  `configFor`/`launchConfig`. `kickInstall` runs the shell step after the tree on a Mac.
  The Windows output is unchanged (its existing tests pass as they were).
- engine/agent-browser-config.js: prints the config path or nothing, never installs
  (`install: false`), always exits 0.
- bin/agent-supervisor.sh, Claude arm: runs the shim with Kosmos's node and adds
  `--mcp-config <path>` only for a path to an existing file, before
  `--dangerously-skip-permissions`.
- server.js: on darwin the board calls `installWithRetry`: it kicks the install at boot and,
  if the install fails (no network at login, a stall, a bad checksum), logs why and retries
  with backoff (1 minute doubling to an hour) until it succeeds or the operator opts out.
  Never fatal, never awaited, timers unref'd.
- A sandboxed board never downloads: `installWithRetry` does nothing under
  `AGENT_WORKFORCE_DRY_RUN=1` (what the browser-check harness sets), and tools/browser-checks.sh
  exports `KOSMOS_AGENT_BROWSER=off`, which also covers its #1573 boards that do not set
  DRY_RUN. The kick is inside server.js's `require.main === module` block, so a check that
  starts the server in-process (`srv.start`) never reaches it.
- Rejected: also skipping when `AGENT_WORKFORCE_DATA` is set. install/setup.sh:1319 exports it
  for a real install whose KOSMOS_HOME is not the default, so that would silently turn the
  browser off on real Macs.
- Opt-out: `KOSMOS_AGENT_BROWSER=off`, or a file named `off` in the managed
  `playwright-mcp` folder. The file is the Mac's real path: a launchd-started supervisor
  does not inherit the operator's shell env. The boot install honours it too. The file is
  read on Windows as well (nothing creates it, so Windows behaves as before). It is read
  fresh at every agent launch; an install the board skipped because of it is not started
  again until the next board start.
- One folder per shell version AND per CPU (`chrome-headless-shell/<version>/<arch>`), so
  installing one CPU's shell does not replace another CPU's shell of the same version.
- Mostly one install at a time: `ensureShell` takes a lock file holding its pid and touches it
  every minute while it works. It is taken over only when the owner is gone or the heartbeat
  has stopped for 5 minutes, so a dead owner whose pid was reused cannot hold it forever. The
  lock is not airtight (two takers of one stale lock, or a Mac asleep through a live owner's
  heartbeat, can leave two installers running). `ensureShell` re-checks for an installed shell
  after taking the lock and again just before its swap, and both installers write the same
  pinned, checksum-verified bytes. Under the lock it sweeps what interrupted installs left
  (staging folders whose owner pid is gone) and prunes other shell versions to the single
  highest one, by version order and only among version-named folders (a whole version folder,
  every CPU in it), which a still-running agent from the previous release may name.
- The board's retry gives up after 3 failures in a row that happened after a complete download
  (the checksum, the unpack, or the shell not answering its version), and logs why: those do
  not fix themselves, and each try downloads about 100 MB. A body of the wrong size (a cut
  download) counts as a network problem and keeps retrying. A Mac CPU with no pinned build
  stops at once: it cannot change.
- A lock or staging folder carrying the board's own pid that it does not hold is a leftover
  from before a restart (launchd can reuse a pid), and is cleared.

## Evidence
- Real install in a sandbox: `ensureShell` downloaded, matched the pinned sha256, unpacked and
  proved the arm64 shell in 9.9s (211 MB unpacked); `launchConfig('darwin')` wrote the config.
- Real agent: `claude -p --mcp-config <that file>` used mcp__kosmos-browser__browser_navigate,
  browser_wait_for and browser_snapshot, not WebFetch, and read Google Flights DFW-LAX fares
  for 2026-10-15 ($101 and $124 Frontier, $169 Southwest/American/Delta).
- Kayak returns "What is a bot?" to this shell and to installed Chrome in headless mode alike.
- tools/test-supervisor-agentbrowser-3633.sh: the installed-arm checks pass on this branch; against
  origin/main's supervisor, the three installed-arm checks fail (the control).
- engine/agentbrowser.test.js: see the count below.

- The "launch never installs" checks can fail: with the shim switched to `install: true`, the
  unit test's no-install assertion and the shell test's arm 2 both went red (arm 2 found
  `.staging-<pid>-<ms>`); restored, both pass. Unit tests: 30 pass (24 of them new for the Mac); `configFor` refuses a Mac config with no shell path. Shell test: 11 checks
  across five arms (installed, not installed, env opt-out, file opt-out, installed with a
  model); with the model line's flag removed, only the model arm fails.

## Known and left
- Nothing in the app writes the opt-out file yet: an operator creates it by hand. A Settings
  switch is a follow-up.
- Pruning keeps the pinned version and one other, so an agent whose browser runs from a
  version two or more releases old loses that folder at the next install, and with it its
  browsing (Chromium starts helper processes from its own folder), until the agent restarts
  and gets the current config.
- A future `SHELL.version` bump: an agent relaunched before the new download lands gets no
  browser, although the previous version's shell is still on disk, and gets it back only at its
  next relaunch after the download. Nothing is affected today (this is the first pinned version);
  a fallback to the highest installed proven version belongs with the first bump.
- The lock's heartbeat (the owner touching the lock every minute) has no test of its own; the
  takeover rules around it do (live pid refused, dead pid taken, stale heartbeat taken, a lock
  with no readable pid yet treated as live).
- The shim and the board each take the Mac CPU from `hostArch()` (the one place
  `process.arch` is read, pinned by a test), each in its own process. In the installed layout
  both run the bundled node, so they agree. If they ever differ, the shim finds no shell for
  its CPU and passes no flag; the board's install is untouched (the folders are per CPU).
- `outputDir()` is one temp folder shared by every agent's browser output, as on Windows.

## Weakest premise
That about 100 MB, downloaded once in the background at board start with no prompt, is
acceptable. Windows downloads about 4 MB. If Josh wants a confirm like the Claude Code
install has, that is a UI change on top of this.
