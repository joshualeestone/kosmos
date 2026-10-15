# move-steps-winlinux-6183 — Windows/Linux account-move restarts as async steps (#6183)

## Problem

#6173 (merged in #6202 at origin/main 0279d48ec) made an account move restart its
agents one at a time through an async driver (`removal.restartAsync` →
`driveAsync` in `engine/remove.js`), so on the Mac the board stays responsive:
each launchctl/tmux command runs via `execFile` and each wait is a timer, off the
board's thread.

On Windows and Linux the restart acts still run synchronously. The async driver
consumes per-platform **steps** when an arm provides them (`engine/remove.js`):

- `const act = (k,...a) => (ops.steps && ops.steps[k] ? ops.steps[k](...a) : now(() => ops[k](...a)));` (remove.js ~L2210)
- session: `sops.endSteps ? sops.endSteps(session) : now(() => sops.end(session))` (remove.js ~L2234)

The win32 and linux **jobOps** arms expose only synchronous acts (no `steps`), and
the win32 **sessionOps** arm exposes no `endSteps`, so the async driver falls back
to `now(() => ops[k](...))` / `now(() => sops.end(...))` — which runs the blocking
call inline on the board's thread. So an account move still freezes the board for
the length of one restart at a time on those platforms.

Linux session-end is already covered: `sessionOps` only special-cases win32, so
Linux falls through to the shared tmux `endSteps` generator (remove.js ~L780).
Only the win32 session needs `endSteps`.

## Done when (from the card)

1. On Windows and Linux, an async restart sends no command through a synchronous
   runner, and its waits are timers. Proven the way #6173's Mac test proves it: a
   timer keeps firing during an async restart, and a sync-runner seam is never
   asked.
2. The windows CI job runs that test.
3. The sync restart callers keep today's behaviour.

## Which acts need steps

`restartSteps` (remove.js ~L2120) consumes job acts only through `act(k,...)`:
`stopNow` (L2294), `startNow` (L2299, L2326), `loaded` (L2307 via `confirmLoaded`),
and `ops.steps.diagnose` (L2342). `disable`/`enable` are the REMOVAL path
(`removeInner`), which is synchronous and out of scope. `waitUnloaded`/`{unload}`
is Mac-only (guarded by `if (ops.waitUnloaded)` / `ops.linux`), so win32/linux do
not use it.

So the restart steps to add:
- win32 jobOps: `steps.stopNow`, `steps.startNow`, `steps.loaded` (the liveness
  poll — the blocking wait that must become `{sleep}`+`{exec}`). win32 has no
  `diagnose` today (jobOps win32 arm omits it → diagnostics null); keep as-is.
- win32 sessionOps: `endSteps` (win32stop end + look-again).
- linux jobOps: `steps.stopNow`, `steps.startNow`, `steps.loaded`, `steps.diagnose`.
- linux sessionOps: already the shared tmux `endSteps` — nothing to do.

## Design

Mirror MAC_STEPS (remove.js ~L702): generator steps that `yield {exec:[file,args,opts]}`
per command and `{sleep: ms}` per wait, answered by remove.js's `answerSync`/
`answerAsync` → `run()` / `runAsync()`. The sync driver (`driveSync`) runs them via
`execFileSync`+`Atomics.wait`; the async driver (`driveAsync`) via `execFile`+timers.

- The command **specs** (task/unit names, arg arrays) and result **parsers** stay
  the single source of truth in `engine/win32job.js` / `engine/win32stop.js` /
  `engine/linuxjob.js` (sync public API unchanged → Done-when 3). WIN32_STEPS /
  LINUX_STEPS in remove.js call those spec-builders + parsers between yields.
- Linux acts ALREADY route exec through remove.js's `run()` via
  `lj.runWith((file,args)=>run(...))` (#4918, remove.js ~L642). Converting them to
  steps means they route through `runAsync` under the async driver instead, so the
  SAME `setRunner`/`setAsyncRunner` seam proves it.
- win32 acts currently use win32job's OWN `execFileSync` (NOT remove.js `run()`).
  To keep the board free, the win32 restart commands must route through remove.js's
  `run()`/`runAsync()` via the `{exec}` step protocol. Keep win32job's sync public
  functions (sync callers) unchanged; the restart path uses the new steps.

### Keeping the sync arms identical (Done-when 3)

Follow the Mac pattern: the sync jobOps/sessionOps acts drive the SAME generator
with `driveSync` (e.g. Mac `stopNow: (n,j) => driveSync(MAC_STEPS.stopNow(n,j))`).
So win32/linux sync `stopNow`/`startNow`/`loaded` become `driveSync(WIN32_STEPS.x())`
/ `driveSync(LINUX_STEPS.x())` — one body per act, byte-identical behaviour under
the sync driver, and the async driver gets the generator via `ops.steps`.

## Test (Done-when 1) — mirror remove.test.js:3054 / :3089

- Async proof: `setRunner` pushes to `sync[]` and must stay empty
  (`assert.deepEqual(sync, [])`); `setAsyncRunner` collects `calls[]`; `watchTurns()`
  asserts `turns > 10` and `maxGap < 1000`; run `restartAsync({platform})`, assert
  outcome RESTARTED and the command sequence went through the async runner.
- Sync control: a sync `restart({platform})` holds the board for its whole wait
  (`fired === 0`, `took >= <wait>`), so the async responsiveness is a real contrast.
- One test arm for win32, one for linux. Use a long retry/poll wait via env (as
  `withWaits` does) so a blocking wait could not hide under a scheduling hiccup.

## CI (Done-when 2)

Ensure the new test file runs in the `windows` CI job (and the Linux arm wherever
Linux tests run). Check the workflow's test selection includes the new file (the
suite globs engine/*.test.js, but confirm the windows job's filter picks it up —
guard against `a-bare-glob-runs-half-the-suite`).

## Boundary with #6214 (Sonya, branch stopmove-6214)

#6214 touches `engine/accountmove.js` (new stop()/put-back), a `POST
/api/agents/account-moves/stop` route in server.js, and web/index.html. This card's
round-5 comment suggested INTERIM stopgaps in `engine/accountmove.js` (setImmediate
yield between agents; count aborted reads apart from bad answers) — those are
"until then" workarounds the real step fix makes unnecessary, and they are #6214's
file. **I will not touch engine/accountmove.js.** I expect little-to-no server.js
change (platform dispatch lives in remove.js `sessionOps`/`jobOps`); if I do touch
server.js it will be disjoint from the new stop route, and I will tell Sonya. I
will not change `restartAsync`'s external contract or the move loop; if that
changes, I ping Sonya to rebase.

## Weakest part of my reasoning (named, per discipline)

- Whether win32's commands can be routed onto remove.js's `run()`/`runAsync()`
  seam cleanly WITHOUT breaking win32job's own dry-run / live-execution gating and
  its sync callers. Linux already did this in #4918; win32 has not. The two
  module-map passes (in flight) will show win32job's exact exec seam, dry-run gate,
  and poll structure (`win32job.running` liveness poll) before I commit the design.
- win32job.`running`'s liveness poll reads a state file (win32streamstate), not a
  process command — so its "wait" is a sleep between cheap file reads. Confirm the
  file read is acceptable inside a generator (it is non-blocking I/O-wise); the
  {sleep} is what matters for board responsiveness.

## What would change my mind

If win32job's exec/gating cannot be routed onto remove.js's seam without changing
sync-caller behaviour, fall back to giving win32job its OWN runWith seam (like
linux's #4918) AND generator step-builders in win32job, with remove.js's WIN32_STEPS
delegating to them — more code in win32job, same board-responsiveness guarantee.
