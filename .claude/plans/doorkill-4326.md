# doorkill-4326: a door's status probe always ends; no test runs the real gh / vercel (kosmos#4326)

On 2026-09-28 a `vercel whoami` orphan ran 2h39m at ~600 MB on Agent1s and fed a night of memory
pressure (Mona diagnosed, Splinter killed it). Two causes: a test's board ran the REAL vercel, and
engine/devicedoor.js's status probe used execFile's `timeout`, which sends SIGTERM and nothing after.

Checked before building: #4309/#4320 (test-support/nohostcli.js) had ALREADY fixed the three
connections tests the card names on main (they point the doors at nothing). So this adds what was
still missing: the product fix, a suite-wide guard, and the one connections test #4309 did not cover.

## What
- **engine/devicedoor.js** `runBounded` replaces execFile for the status probe. The caller is
  answered at the timeout (or when a stream passes 1 MB, as execFile's maxBuffer did); the child
  gets SIGTERM and then SIGKILL after a 2 s grace. It is NOT detached, so it stays in the board's
  process group and dies with the board (a detached probe would outlive a board restart, and with it
  its kill timers). The answer keeps execFile's shape: (exit code, stdout then stderr).
- **test-support/tool-guard.js**, preloaded into every test process by tools/run-tests.sh beside
  launch-guard.js: a real gh / vercel / cloudflared at command position (a file, a shell script's
  command words, an exec string; a bare name judged by the call's PATH) is refused before it runs,
  and the FILE fails through an uncaught throw. execFile and exec keep their promisify.custom.
  Its header states what it does not see.
- **tools/run-tests.sh** exports test-support/fake-cli-signed-out.sh (answers "signed out" at once)
  as the default AGENT_WORKFORCE_GH_BIN / AGENT_WORKFORCE_VERCEL_BIN.
- **server.remote-bind-1112.test.js** pins the fake (not covered by #4309).

## Evidence
- engine/devicedoor-bounded-4326.test.js: a SIGTERM-ignoring probe is answered at the timeout and
  SIGKILLed; the probe dies with its board's process group; stdout-then-stderr order; a 2 MB flood is
  stopped at once; normal and non-zero exits pass through; a missing binary answers -1.
- test-support.tool-guard-4326.test.js: path and parser rules (command position only, quotes, $VAR,
  cwd, the call's PATH); promisify(execFile) keeps { stdout, stderr }; a file that reaches the
  stand-in "real" vercel via execFile, exec, shell:true, sh -c, bash -lc, fish -c, cmd /c or
  pwsh -Command FAILS and the stand-in never runs; controls pass.
- Mutants across the rounds each red their row: no SIGKILL, detached, interleaved output, no overflow
  stop, no promisify.custom, literal '-c' only, every-token matching, quote-blind splitting, a guard
  that never refuses.
- The GitHub/Vercel test files plus the promisify callers under the runner's env: all pass, the guard
  refused nothing. engine.runnable-not-directory's audit passes.
