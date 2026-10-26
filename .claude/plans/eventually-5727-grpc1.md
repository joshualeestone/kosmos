# eventually-5727-grpc1 -- #5727 Group C, batch C1: scale CLI spawn kill budgets

## Problem

kosmos#5727 is the "wall-clock flake class": under host load the test suite
false-reds about one timing test per run, because hand-rolled fixed wall-clock
deadlines fire while a correct test is merely descheduled. The shared helper
`test-support/eventually.js` fixes this by scaling a liveness budget by
`KOSMOS_TEST_TIME_SCALE` (computed once per run by `tools/run-tests.sh` from the
box's load-per-core), floored at 1 and capped at 4x.

The merged batches so far (Groups A and B, remote) migrated the POLL loops
(`until()/waitFor()/poll()`). They did not touch a second mechanism: each
`cli.*.test.js` rolls its own CLI spawn with a FIXED wall-clock kill budget (an
`execFile`/`run` `timeout:` option, or a manual `setTimeout(() => child.kill(), N)`).
Under heavy load the child is descheduled and killed at that fixed deadline, which
is the SIGKILL/SIGTERM class of reds logged on #5727 this week. The runner already
scales its OUTER ceilings (per-test `--test-timeout` and the file watchdog) by the
same scale; these INNER budgets were not scaled, so they fire first.

## Approach (Group C)

Wrap each inner CLI-spawn kill budget in `scaleBudget(N)` from
`test-support/eventually.js`. Same safety envelope as the helper: floored at 1 so
CI and an unloaded box are byte-identical (`scaleBudget(n) === n` at scale 1),
capped at 4x so a genuine hang is still caught. A liveness ceiling that grows with
load, never a weakened assertion. Only a wall-clock LIVENESS ceiling (how long the
test WAITS for the CLI) is scaled -- never a stub's STIMULUS delay, which is the
thing under test.

Group C is ~75 cli.*.test.js files with a fixed spawn/execFile timeout. It ships in
small reviewed batches, seen-red first, to keep each diff reviewable and consistent
with how Groups A/B were sized (1-6 files each).

## Batch C1 scope (this branch)

Three seen-red files, one per spawn mechanism:
- `cli.community-edit-5574.test.js` -- `execFile(CLI, args, { timeout: 30000 })` x2
- `cli.accounts-5359.test.js` -- `spawn` + manual `setTimeout(() => child.kill('SIGKILL'), 20000)`
- `cli.agent-create-3734.test.js` -- `run = promisify(execFile)` called with `{ timeout: 20000 }`

Each fixed budget wrapped in `scaleBudget(N)`; `scaleBudget` imported from
`./test-support/eventually`. In `cli.accounts-5359.test.js` the kill budget is
hoisted to a `const killMs` and interpolated into the failure diagnostic, so the
message states the actual budget rather than a stale "20s limit".

## What finished looks like

1. Each fixed spawn/execFile kill budget in the three files is `scaleBudget(N)`.
2. Byte-identical at scale 1: `scaleBudget(N) === N` when the scale var is unset/1,
   so CI behavior is unchanged.
3. The three files pass at natural scale and at a forced scale.
4. No test assertion is lowered; only the wall-clock kill budget scales, within the
   helper's floored/capped envelope.

## Verification

(Results below are from the pre-PR run on Mortals; the commands and logs live in the
build session and the pre-challenge proof file, and CI reruns them on the PR.)

- Unit: `scaleBudget(30000) === 30000` and `scaleBudget(20000) === 20000` at scale 1;
  4x under load (120000 / 80000); a stray value clamps to 4x.
- `run-tests.sh --only` the three files: 23/23 pass at natural scale AND at forced
  `KOSMOS_TEST_TIME_SCALE=4` (exit 0).
- Full-suite pre-PR validation: the only reds were pre-existing contention flakes
  outside this diff (`cli.refused-retry-6968` is filed separately as #7258;
  `server.phonenotify-718` passes 49/49 in isolation). None in the three changed
  files. CI on quiet Linux is the authoritative gate for this flake class.

## Out of scope / follow-ups

- Files that Groups A/B already touched had only their POLL loops migrated; their
  CLI-spawn kill budgets are still unscaled and are Group C targets. Confirmed cases:
  `cli.connections-4451.test.js:79` (`setTimeout(() => child.kill('SIGKILL'), 20000)`,
  grpb4 scaled its polls not this) and `cli.busy-health-4466.test.js:35,45`
  (`runCli`/`bash` default `timeout = 40000`, grpa3 scaled its page-close poll not
  these). "Already migrated" for those files means polls-only, not done for Group C.
- None of these are in this diff; C1 is kept to its three seen-red files. The
  remaining ~70 Group C files (these included) follow in subsequent batches.
