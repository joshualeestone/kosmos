# #5727 Group C, batch C2 — scale inner CLI-spawn kill budgets

Branch: `eventually-5727-grpc2` (worktree off `origin/main` 8a8059fc61, which includes C1's merge).

## Context

Groups A/B/remote migrated the POLL loops (`until`/`waitFor`/`poll`) to `eventually()`.
Group C is the second wall-clock mechanism: each `cli.*.test.js` rolls its own CLI spawn
with a FIXED kill budget (an `execFile`/`run` `timeout:` option, or a manual
`setTimeout(() => child.kill(), N)`). run-tests.sh scales its OUTER ceilings by host load
(`KOSMOS_TEST_TIME_SCALE`); these INNER budgets were not, so under load the child is
SIGKILLed first — the #5727 red class. Group C wraps each inner budget in `scaleBudget(N)`
from `test-support/eventually.js` (floor 1 so CI is byte-identical at scale 1, cap 4x).
Only a LIVENESS ceiling (how long the test waits for the CLI) is scaled, never a stub's
STIMULUS delay. C1 (PR #7297, 3 files) set and Liu-approved this precedent.

## Files changed (2)

### `cli.connections-4451.test.js`
- The `cli()` run helper spawns the CLI and SIGKILLs it at a fixed `20000` ms (L79), with a
  failure diagnostic that said a stale "20s limit".
- Change: hoist `const killMs = scaleBudget(20000)`, use it in the `setTimeout` kill, and
  interpolate it into the diagnostic so the message states the real budget, not "20s".
  (Identical pattern to C1's `cli.accounts-5359.test.js`, already Liu-approved.)
- `scaleBudget` was already imported here (L23, used at L118/L166); no require change.
- Untouched: the interrupt tests' `at = Date.now()` / `took < 2000` budget windows, the
  `reachStage` deadline (already `scaleBudget`-wrapped), the fixed stub `holdMs` / 300ms
  settle / SIGTERM paths.

### `cli.busy-health-4466.test.js`
- `runCli` (L38) and `bash` (L47) pass `{ env, timeout }` to `execFile`, where `timeout`
  defaults to `40000` — the kill budget that SIGKILLs a CLI the harness has waited on.
- Change: scale at the call site — `{ env, timeout: scaleBudget(timeout) }` in both — so the
  default AND any explicit caller value are scaled.
- Require updated to `const { eventually, scaleBudget } = require('./test-support/eventually')`.
- Safe against this file's measured bounds: the returned `.ms` is `Date.now() - t0` (real
  elapsed, independent of the `timeout` option). Every measured assertion bound in the file
  is below 40000 (max is `ended - t0 < 20000`), so the execFile `timeout` is purely the
  SIGKILL safety net above all assertions; scaling it up only extends that net and fires no
  assertion earlier/later. The stub delays (`delayMs`, the `setTimeout(reply, delayMs)` in
  the stub server, `withBoard`'s cleanup kill) are STIMULUS and are left untouched.

## Why safe (both files)

- Byte-identical at scale 1: `scaleBudget(n) === n` when `KOSMOS_TEST_TIME_SCALE` is 1/unset
  (unit-checked: 20000→20000, 40000→40000). CI runs at scale 1, so CI is unchanged.
- Cap 4x (unit-checked: scale 4 → 80000/160000; scale 99 clamps to 80000), so a genuine hang
  is still caught, just later under load.
- Only wall-clock liveness ceilings scale; no assertion is lowered and no stub stimulus delay
  is touched.

## Test plan

- Unit: `scaleBudget` at scale 1 (byte-identical), scale 4 (4x), stray clamp (4x cap). DONE.
- Run-before-trust (both files are timing-sensitive — busy-health asserts hook/busy budgets,
  connections has interrupt-timing arms): `node --test` the 2 files at scale 1 (×2) and
  scale 4 (×2), under the box claim, once the 0.7.71 release frees the box. scale 1 is
  byte-identical to pristine (the extra `scaleBudget` call returns the input unchanged), so a
  green scale-1 run is the pristine baseline.
- `/challenge-loop` to convergence, then the proof file and PR.

## Out of scope / follow-ups

- Kept to these 2 seen-red files. The remaining Group C files follow in later batches.
- The upper-bound timing assertions in busy-health (e.g. `out.ms < 12000`) are a SEPARATE
  flake axis under extreme load; Group C does not touch them (they are measured bounds, not
  liveness ceilings).

Addresses #5727
