# flakes-6432: two full-run-only test failures (kosmos#6432)

## 1. cli.connections-4451.test.js, "an interrupt while the token is still arriving on stdin"
- Cause (test): the setup wait for the private token file was a fixed 5 s. `cmd_connect` (install/kosmos, around
  line 3120) runs `healthy()` BEFORE `mktemp` makes that file; it probes with a 2 s budget and, on a slow answer,
  retries with probes doubling up to BUSY_PROBE_MAX_S=8, clamped to the BUSY_WAIT_DEFAULT_S=20 window. One slow
  probe under load pushes the file past 5 s, and the CONTROL fails.
- Second, smaller gap: the test read "file exists" plus a fixed 300 ms as "writer running", but mktemp makes the
  file a few lines before the INT/TERM/HUP traps are set, so a slow scheduler could signal an untrapped CLI.
- Fix: `reachStage()` waits up to 30 s (a scaled liveness deadline: up to 120 s at the 4x cap, where the old
  wait was a fixed 5 s), ends early if the CLI exits and puts its output in the CONTROL message. The stdin test
  waits for the writer itself (`writerRunning()`: a child of the CLI, found with pgrep -P, whose full command
  (ps -ww) names the kosmos-connect. file in its TMPDIR); the traps are set before that node starts. The 300 ms
  sleep is gone. The poll is async and runs pgrep/ps only once the file exists, so it never blocks the event loop
  that serves the stub board's health answer. The "door checks the token" test uses the same wait for its POST.
  In both, the 6 s hard timeout (which also killTree()s the CLI's children) goes through scaleBudget; the 2 s
  promptness bounds stay a fixed 2000 ms (a performance bound, which must not scale, per eventually.js).
- Not fixed (older cmd_connect race, out of scope for a test card): the writer running means the traps are set,
  but cmd_connect records its pid (`_npid=$!`) one line after the background launch, and bash runs a trap only
  between commands, so a signal in that one line stops the CLI and not the writer. Dropping the 300 ms sleep makes
  that window slightly more reachable for the test. stopAndClean cannot reach such a writer once the CLI has
  exited (reparented, so pgrep -P misses it); only a failure path leaves one.
- No fixed ports (stub on port 0), private TMPDIR and data root per run: no cross-test collision found.

## 2. server.guide-on-connect-3660.test.js, "a model connected AFTER Giddy Up is picked up by the sweep"
- Cause (product, seen by the test): `markSetupAssistantSeeded` in engine/setup-assistant.js wrote
  setup-assistant.json with a plain `fs.writeFileSync`, which truncates and then writes. The test polls every
  100 ms with `existsSync` then `JSON.parse(readFileSync)`; a poll inside that window parsed "" and threw
  "Unexpected end of JSON input". The product reader `guideName()` had the same window (it returns null, so a
  transient wrong answer, not a crash).
- Fix: the flag is saved with `store.saveFlushed` (securewrite temp + rename, atomicOnly, umask default mode, as
  profiles and settings are). atomicOnly throws where the old code could rewrite in place (securewrite.js ~474),
  so a failed save now returns false where it could before leave a partial file. The test reads through
  `readFlag()`, which polls past an unparsable read and names the last raw bytes if the flag never parses.
- Server child gets PORT=0 and a mkdtemp sandbox for every root: no collision found.
- Also changed: the test waited for the flag with a fixed, unscaled 10 s. Its reported failure was a parse, not a
  timeout, so this is not the fix; the wait now goes through scaleBudget (one line in waitForFlag and its require).

## Weakest premises
- Both causes are inferred by reading, not reproduced. For 4451 the card says load was moderate (6.38 on 12
  cores); a 5 s miss then needs one slow health probe, which I did not measure.
- For 3660 the reported line (124) is the test's declaration, not the parse, so which JSON.parse threw is
  inferred: the only parse in that test is of the flag file, and the server is a separate process whose own
  throw could not surface in the test as a SyntaxError.
- 4451 still has one assertion that can fail under heavy load: the fixed 2000 ms promptness bound (a performance
  bound, deliberately unscaled). The card's failure was a setup CONTROL, not this bound.
- "#6432 ATOMIC" (engine.setup-assistant-3034.test.js) proves the save goes through store.saveFlushed and never
  fs.writeFileSync to the flag path (a revert reds both arms, reasoned, not run). It does not race a reader: the
  no-partial-read property rests on saveFlushed's temp-and-rename.

## Reproduction attempt (2026-10-17 16:39 CDT)
- 20 runs of each of the two files on origin/main 112701ff and on the fix 0f8d5318, interleaved, 8 in parallel,
  beside 6 CPU hogs: 0 failures on either side (160 tests each). The four sibling files: 93/93.
- So the causes rest on reading: the run shows the fix does not break these files, not that it removes the flake.

## Run
node --test cli.connections-4451.test.js server.guide-on-connect-3660.test.js engine.setup-assistant-3034.test.js
server.setup-guide-page-3034.test.js engine/state21.fsync-5434.test.js engine/setupsettings.fsync-5434.test.js
