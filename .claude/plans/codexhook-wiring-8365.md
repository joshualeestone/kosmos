# codexhook-wiring-8365: test the Codex hook installer the supervisor actually runs (kosmos#8365 item 2)

**Posture:** production

Item 2 of #8365, from the review of #8367. In engine/win32codexsup.js the default `installCodexHook` closure
(`installCodexHookFor(home, binNow(), turnEnv)`) is cut short under `inTestRun()`. Every test either replaced it
through the `installCodexHook` seam or called `installCodexHookFor` directly, so a regression in the wiring would pass
every test and quietly stop the hook installing for every Windows Codex agent. Examples: a captured bin, or a probe run
with the board's env instead of the turn's.

## Change
- engine/win32codexsup.js: a narrower seam, `codexHookDeps` (installCodexHookFor's own `{ execFile, install,
  bridge, personHomes, canonical }`). When a test passes it, THE DEFAULT CLOSURE runs, with nothing real behind it.
  Without it, a test run still does nothing there, as before. Production is unchanged: it never passes the option.
- engine/codexhooks.win32-8348.test.js: two tests through that closure.
  - With a named home, it probes the codex the turns run (o.bin), with the turn's own env object, installs into that
    home with the parsed version, and reports codex-hook-installed. The turn then runs the same codex with the same env.
  - The person's own home gets no probe and no install. Without the deps, a test run reports nothing.

## Verified
- The new file is 25/25 with the real-Codex arm skipped (it needs KOSMOS_TEST_CODEX_BIN). The win32codexsup suites
  are 11/11 and 12/12, and engine.reachable is 8/8.
- Control: the closure changed to probe with process.env instead of turnEnv fails the new test ("with the turn's own
  environment, so a bare name resolves as the turns resolve it").

## Decided
- A deps seam rather than lifting the inTestRun guard. Lifting it would make every existing supervisor test start a
  real `codex --version`. Rejected: exporting the closure, which would need the supervisor's private bin and env.
- Hardened in review: only a set that replaces BOTH the probe (execFile) and the install counts. A partial set stays
  inert in tests, so a test can never start a real `codex --version` or write a real hook through the seam.
- Control 2: with the inTestRun guard removed, the no-deps check fails ("no real codex --version was started"). A spy
  on the real child_process.execFile catches the attempt itself.
- Weakest part: the env and bin checks pass o.env and o.bin, so they show the closure hands on what the supervisor
  holds, not how childEnv builds it (covered by its own tests).
