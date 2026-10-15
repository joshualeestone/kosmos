# move-steps-win32-6183 — Windows account-move restarts as async steps (#6183, Windows half)

## Problem

#6173 (Mac) and #6230 (Linux, merged) made an account move restart its agents through
an async step driver in `engine/remove.js`, so each restart runs with `execFile` + timers
off the board's thread and the board stays responsive. Windows is the last platform still
synchronous: `jobOps('win32')` (remove.js ~605-636) exposes no `steps` object and
`sessionOps('win32')` (~787-792) exposes no `endSteps`, so `restartSteps`'s
`act(k,...) = ops.steps && ops.steps[k] ? ... : now(() => ops[k](...))` takes the `now(...)`
(synchronous) branch for every win32 restart act, and the session close takes
`now(() => sops.end(session))`. The blocking cost is mostly inside `win32job.running`'s
liveness poll (an internal `sleepSync`/Atomics.wait between state-file reads), which freezes
the board for the length of one restart at a time.

## Done when (from the card, mirroring #6173/#6230)

1. On Windows, an async restart sends no command through a synchronous runner and its waits
   are timers, proven like the Mac/Linux tests: a timer keeps firing during an async restart,
   and a sync-runner seam is never asked.
2. The `windows` CI job runs that test.
3. The NON-restart synchronous callers (removeInner, world-switch, register) keep today's behaviour. The
   synchronous RESTART now drives the same step generators via `driveSync` (restartSteps prefers `steps`), so its
   schtasks route through remove.js's run() rather than win32job's/win32stop's own runners -- the restart executor
   unifies across the sync and async drivers (as the Linux half already did, via its `via` runWith seam). Behaviour
   is preserved: same commands, same parse/outcomes, and the step generators clear PRESENCE_MEMO as win32job.run()
   does, so presence() is not left stale after a step-driven stop/start. Two deliberate consequences of the executor
   move, shared with the merged Linux half: the step path's test-process guard is remove.js's liveExec rather than
   win32job's stricter schtasksMayRunInThisProcess (both fail-closed; the execArgv/inTestProcess case holds, the
   NODE_TEST_CONTEXT-only spawned-server case is the residual), and a test driving the sync restart injects commands
   via remove.setRunner, not win32job's seam.

## Current win32 architecture (verified on this base, 3c6a76606)

- `engine/win32job.js`: `run(args)` (own `execFileSync('schtasks.exe')`, seam `setRunner`)
  returns `{ ok, out, code }` — reads/produces **`out`**, not `stdout`.
  - `end(name,worldId)` (schtasks `/End`), `start(name,worldId)` (`/Run`): parse `r.ok` +
    `r.out`.
  - `running(name,worldId,opts)`: the liveness poll — NOT a command. Reads a state file via
    `liveIdentity` + `pidAlive` in a `for(;;)` loop with an internal `sleepSync(intervalMs)`
    between polls (default interval 250 ms, deadline 12000 ms); accepts when the live pid is
    alive and (for a restart) its `sessionId` differs from `before`. Seams: `setLiveness`,
    `setRunningClock(now, sleep)`; per-call opts `liveIdentity/isAlive/now/sleep/intervalMs/deadlineMs`.
- `engine/win32stop.js`: `run(args)` (own `execFileSync('taskkill.exe')`, seam `setRunner`)
  returns `{ ok, out, code, dryRun }` — reads **`out`**. `end(name,opts)` → `resolve`
  (`liveByName`, a read) → `killAndForget(pid,sessionId)` which runs `['/PID',pid,'/T','/F']`,
  tests `r.ok || r.code===128 || /not found|no running instance/i.test(r.out)`, looks again
  `alive(pid)`, then `win32sessions.forget(sessionId)`.
- `engine/remove.js` `jobOps('win32')`: acts call win32job/win32stop's OWN runners directly
  (NOT remove's `run()`/`via` as Linux does), and there is no `steps` object. `sessionOps('win32')`
  exposes only `end`, no `endSteps`.
- `restartSteps` consumes job acts via `act(k,...)` (remove.js ~2225) and the session via
  `sops.endSteps ? ... : now(() => sops.end(session))` (~2249). A step generator yields
  `{ exec:[file,args,opts] }` (answered by remove's `run()` sync / `runAsync()` async, both
  returning `{ ok, stdout, stderr, code }`) or `{ sleep: ms }` (answered by `sleepMs` sync /
  `setTimeout` async). `{unload}`/`{retry}` are Mac-only.

## Design (mirror the Linux steps pattern)

Add step generators that yield the restart commands and the liveness waits, wired into the
async driver, with the sync acts kept for their own callers (Done-when 3).

### engine/win32job.js
- `endSteps(name, worldId)`: `yield { exec: ['schtasks.exe', ['/End','/TN', taskName(name,worldId)], opts] }`,
  normalize the result, then the SAME parse `end()` uses. Returns the same shape as `end()`.
- `startSteps(name, worldId)`: `yield { exec: ['schtasks.exe', ['/Run','/TN', taskName(...)], opts] }`,
  normalize, same parse as `start()`.
- `runningSteps(name, worldId, opts)`: the liveness poll as a generator. Reads `liveIdentity`
  + `isAlive` IN the generator (cheap non-blocking reads, NOT yielded), and between polls
  `yield { sleep: intervalMs }` instead of `sleepSync`. Keeps the `before`/sessionId
  discrimination and the `now`-seam deadline. Returns the same shape as `running()`. This is
  the one step that yields `{sleep}` rather than `{exec}` — the deepest async-conversion work,
  and the piece with no Linux precedent (Linux `loaded` yields an `{exec}` is-active).

### engine/win32stop.js
- `endSteps(name, opts)`: resolve the pid via `liveByName` (a read, in the generator), then
  `yield { exec: ['taskkill.exe', ['/PID', String(pid), '/T', '/F'], opts] }`, normalize, the
  SAME success test `killAndForget` uses, look again `alive(pid)`, `win32sessions.forget`.
  Returns the same shape as `end()`.

### engine/remove.js
- `jobOps('win32')` gains `steps: { stopNow → win32job.endSteps, startNow → win32job.startSteps,
  loaded → win32job.runningSteps }` (wrapping to the Boolean the sync arm returns). No win32
  `diagnose`/`waitUnloaded` (restartSteps already guards their absence).
- `sessionOps('win32')` gains `endSteps → win32stop.endSteps`.

### Friction 1 — result-shape adapter (the biggest deviation from the Linux mirror)
win32job/win32stop parsers read `r.out`; remove's `run()`/`runAsync()` return `{stdout,stderr,code}`.
The step generators must normalize before the existing parse:
`out = r && r.ok ? (r.stdout||'') : (r.stderr || r.stdout || '')`. To keep the sync and step
forms from drifting on the PARSE (the kosmos#120 lesson from the Linux half), extract the
end/start/kill/running parse into a shared helper read by BOTH the sync function and its step
twin, exactly as the Linux half extracted `activeOrActivating`/`statusOf`.

### Friction 2 — executor migration rewrites the existing win32-restart tests
`remove.win32-restart-3431.test.js` (4 sync tests) injects commands through win32job's/win32stop's
OWN seams (`job.setRunner`, `stop.setRunner`) and liveness through `job.setLiveness` /
`job.setRunningClock`. Once the restart routes commands through remove's `run()`/`runAsync()`,
those 4 tests' COMMAND injection and the `/End`-before-`/Run` recording assertions move to
`remove.setRunner`/`remove.setAsyncRunner`. The liveness seam stays win32job's ONLY if
`runningSteps` still reads `liveIdentity`/`isAlive` in-module (it does); but the inter-poll wait
is now a `{sleep}` answered by the async driver's timer, so `setRunningClock` injection for the
async path changes to the driver's clock. Production behaviour is identical (same schtasks/taskkill
args, same parse); only the test seam moves.

## Tests (Done-when 1 + 2)
- Rewrite the 4 `remove.win32-restart-3431.test.js` tests to inject via `remove.setRunner`
  (recording the schtasks/taskkill arg vectors, so the `/End`-before-`/Run` order assertion
  lives at the remove runner) and keep the liveness state-file seam; preserve each test's
  verdict assertions (RESTARTED / PARTIAL / supervisor-never-came-up / stale-file guard).
- Add an async-proof test (restartAsync, platform win32): every schtasks/taskkill goes through
  the ASYNC runner and none through the synchronous one (the deterministic routing proof the
  Linux half used — `sync === []` + the exact command sequence), with a sync control proving
  the sync restart holds the board. The liveness poll's `{sleep}` yields are answered by the
  async driver's timers, so a timer keeps firing during the restart.
- Place the async test where the `windows` CI job runs it (remove.win32-restart-3431.test.js is
  already in that job), and confirm by name.

## restartSteps win32-specific branches to re-check when steps land
`restartSteps` hard-gates several branches on `ops.win32` (the `heldAnswer` at ~2321, the
second-try skip at ~2335, the disruption.clear-vs-fail at ~2366-2368). These were written for
the current synchronous win32 arm; re-verify each still holds when win32 runs through the step
driver (they should, since the arm's `win32:true` flag is unchanged and only the executor moves).

## Weakest part of my reasoning (named)
- `runningSteps` is the novel piece: converting a `for(;;)` + `sleepSync` poll into a generator
  that yields `{sleep}` between in-generator state-file reads, while preserving the deadline
  (via the `now` seam) and the sessionId discrimination. The risk is an off-by-one in the
  deadline/first-read ordering (a dry run or an already-live pid must be read as up on the first
  pass without a spurious sleep). Mirror `running()` turn-for-turn and prove it with a test that
  a live pid returns before any `{sleep}` is yielded.
- The result-shape adapter: a failure result from remove's `run()` carries `stderr`+`code` but
  the win32 parsers read `out`; the normalization must preserve the exit-code tests
  (`r.code===128` in killAndForget) AND the text tests. Pass both `code` and the normalized `out`
  through.

## Stop-a-move put-backs (#6231 item 7) — out of scope for this PR (ruled)

Liu Kang (m5773) and Sonya (m5775) ruled the division so neither PR waits on the other:
- **#6238 (Sonya's stop-a-move) merges first, as-is.** Its Windows put-back stays synchronous; on
  main the Windows move is already a sync board-thread operation, so a sync put-back is no worse
  than today, and its cost is bounded by the page's 60 s limit. Item 7 is a follow-up, not a blocker.
- **This #6183 Windows half = the async win32 step infrastructure + the RESTART wiring only.** It does
  NOT touch `accountmove.js` stop/putBack and is NOT widened to cover the put-back's ops.
- **The put-back goes async in a third, small PR (#6231 item 7), after both merge.** Measured by Sonya,
  a Windows put-back per unreached agent is `/Query` (cachedTaskSpec), `/Query /XML` (taskEnabled), and
  `/Create /F` (win32job.install) — NONE of this half's restart ops (end/start/running/taskkill), so the
  restart step generators do not cover them. They need NEW query/install step generators. Those reuse
  THIS half's infrastructure (the step-generator pattern, the `win32StepResult` stdout→out normalizer,
  and remove.js's async driver consuming `steps`), driven from the stop loop off the board thread. Per
  Liu Kang's ruling the new generators are NOT added here (do not widen #6183); item 7 adds them on top.
  Likely mine to take (infrastructure fresh); card it under #6231 item 7 once #6183 is up. Files are
  disjoint from #6238, so whichever lands second rebases cleanly.

## What would change my mind
If routing win32 commands through remove's `run()` cannot preserve win32job's dry-run / live-exec
gate and its sync callers, fall back to giving win32job/win32stop their own async-runner seam
(like linux's #4918 `runWith`) and generator step-builders in-module, with remove.js's win32 steps
delegating to them — more code in win32job/win32stop, same board-responsiveness guarantee.
