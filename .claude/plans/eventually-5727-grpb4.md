# eventually-5727-grpb4 (#5727 follow-up 1, Group-B batch 4)

Fourth Group-B batch: migrate the two SETUP condition-polls in `cli.connections-4451.test.js`
onto the shared `test-support/eventually.js` helper. Both POSITIVE, non-throwing, zero
timeout-expecting (negative) waits, so none is kept hand-rolled (Liu m5040; Liu m5247 ordered
connections-4451 first, with a care point about its asserted time budgets).

## The two migratable waiters (and the protected budget regions left alone)

A whole-file false-negative hunt (for / while / setTimeout / Date.now / setInterval / waitFor /
new Promise) finds two migratable condition-polls, plus several one-shot / deliberate-delay
constructs that are NOT (c)-family polls and are LEFT UNTOUCHED.

Migrated (both POSITIVE, non-throwing; the following CONTROL assert is the check -> `.catch(() => {})`):
- L153 -> `eventually(() => seen.some((q) => q.method === 'POST'), (v) => v, { timeoutMs: 5000, stepMs: 50 }).catch(() => {})` (wait for the request to reach the stub door).
- L181 -> `eventually(() => fs.readdirSync(tmp).some((f) => f.startsWith('kosmos-connect.')), (v) => v, { timeoutMs: 5000, stepMs: 50 }).catch(() => {})` (wait for the private token file to exist).
Each old loop was `for (i < 100) ... await sleep(50)` (100 x 50ms = 5000ms), so the budget/step are
byte-equal; each predicate is the old `!cond` un-negated.

LEFT UNTOUCHED (Liu m5247 care point 1):
- the two `at = Date.now()` marks and their following `await new Promise(close-race w/ 6000ms SIGKILL)`
  and `const took = Date.now() - at` + `assert.ok(took < 2000, ...)` -- these are the asserted time
  budgets, and the measured wait is a one-shot child-close race, not a (c) condition-poll.
- the stub `if (a && a.holdMs) await sleep(a.holdMs)` (the stub holding the door is the behaviour
  under test), the `await sleep(300)` settle, the 20000ms run-helper hard-kill, and the one-shot
  spawn/exec promises.

## Why this is safe for the asserted budgets (the Liu m5247 proof)

BOTH migrated polls END BEFORE their test's `at = Date.now()` mark (verified by line order:
migrated poll at L155 precedes `at` at L159; migrated poll at L184 precedes `at` at L187). The
`took < 2000` asserts measure `Date.now() - at`, i.e. only the interrupt-to-stop window AFTER the
poll. So scaling the migrated setup polls (up to 4x) cannot change `took` or any asserted value --
the polls are finished before the measured window opens. Nothing between `at=` and the `took`
assert was touched.

## Polarity audit (per Liu m5040) -- both positive, zero negative

Both wait for a condition to BECOME true (POST seen / private file exists) and the following
CONTROL assert checks exactly that. Neither is wrapped in assert.rejects or catch-as-success;
neither expects a timeout. ZERO negative waits.

## Swallowed-throw note (honest)
The probes are synchronous (`seen.some(...)`, `fs.readdirSync(tmp).some(...)`), the same reads the
old loop conditions made; a genuine probe throw would recur at the following CONTROL assert, so
`.catch` hides nothing, and the assert fails if the condition never held.

## File-overlap
`cli.connections-4451.test.js` has NO active sibling worktree touching it. Per Liu m5247 the order
is connections-4451 (this), then provider-accounts-3296, then remote-tick last.

## Validation (Mortals, node v26.8.1), run-before-trust via the light lane (box busy with browser-checks)
`unset KOSMOS_AGENT_TOKEN && bash tools/queued-heavy.sh --light "..." node --test cli.connections-4451.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 5 tests, 5 pass, 0 fail, 0 cancelled, 0 not-ok, 0 timed-out.
- branch, scale 1: 5 / 5 / 0, 0 not-ok (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 5 / 5 / 0, 0 not-ok, 0 timed-out.
CI re-runs the whole suite on the head as the authoritative gate.
