# win-tunnel-js-8378: a JS stand-in for the connector runs on Windows (kosmos#8378, triage batch 1)

**Posture:** production

## Problem
Tests point AGENT_WORKFORCE_TUNNEL_BIN at a fake connector written as an extensionless `#!/usr/bin/env node` (or bash/sh)
script. Windows cannot run a script by its shebang line, so every spawn of the fake gave ENOENT and about 290 tests
failed on Windows (engine/remote.test.js alone 214). The triage of the 40 heaviest Windows-failing files found this the
single largest group, and one that becomes PASSING tests, not skips.

## Change
- **Production seam, one helper:** engine/tunnelcommand.js `tunnelCommand(bin, args) -> { file, args }`. A path ending
  in .js or .cjs (any case) starts as process.execPath with the script first; any other path starts exactly as before
  (same file, same args array). Used at every place the connector is spawned: engine/remote.js
  warmConnectorCapabilities, spawnFedSeat, startChild, setupRun (through its setupSpawn seam); engine/win32uninstall.js
  retirePc. Its own file with no requires, so win32uninstall.js need not load remote.js. Widens nothing: a real connector
  never ends in .js, and the env var already decides what runs.
- **Tests:** the fake connectors are written as `.js` (node scripts); bash/sh fakes rewritten as node with the same
  behaviour (phonenotify, remotestepup, hostedguide, hosted-guide, setup-guide-fallback, rename-push, phonenotify-gate).
  `/usr/bin/true` as the browser opener replaced by `[process.execPath, '-e', '']` (portable, not skipped).
  New engine/tunnelcommand-8378.test.js pins the seam (.js/.JS/.cjs, and extensionless/.exe/.json unchanged).
- **Skipped on Windows, with reasons and HOST_BRANCH_EXCLUDED entries:** remote.test.js #5422 owner-only key folder
  (POSIX modes); three #5422 arms that make saves fail with a read-only folder (chmod 0o500, which Windows does not keep;
  one of them passed there without its premise, so it is skipped with its siblings); #5889 two env names differing only
  in case (cannot both exist in a Windows environment); phonenotify-718 #6488 the same read-only folder.

## Measured on the Windows box (pass/fail/skip, before -> after)
engine/remote.test.js 32/214/1 -> 241/0/6; remote.joincode-4794 7/15/0 -> 22/0/0; mac-standing 12/16/0 -> 28/0/0;
server.phonenotify-718 27/25/0 -> 51/0/1; server.remotestepup-6595 11/18/1 -> 29/0/1; account-computers 6/4 -> 10/0;
remote-refusal-5744 0/9 -> 9/0; remote.tlspin-6589 1/11 -> 12/0; remote-typedallow-6590 17/4 -> 21/0; updating-988 37/3
-> 40/0; and the smaller files to 0 failed. server.test.js: 53 -> 47 failing, the six tunnel tests fixed and no new
failure by name (compared against origin/main f7968cb7a4). Untouched tunnel-using files unchanged.

## Watch
- Two #3827 arms in remote.test.js (a failed rename leaves the old certificate beside the new id) failed once in a run
  that shared the machine with server.test.js, and passed in every solo run. They never ran on Windows before; a timing
  sensitivity, or a Windows behaviour in the certificate removal after a failed rename, is possible. Not investigated.
- server.phonenotify-gate-718 passed on Windows before only because its bash fake could never run (it asserts the tunnel
  never ran); now that check can fail.

## Done when
- Every changed file 0 failed on the box (server.test.js: no new failure, six fixed); policy tests green; Mac/Linux CI
  green; the Windows CI job runs the new seam test.
