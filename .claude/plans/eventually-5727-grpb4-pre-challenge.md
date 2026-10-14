---
method: challenge-loop
branch: eventually-5727-grpb4
diff_hash: 79ba3cd23932ddf635a3a3e8ac2b948d0c21f20a0c78aa4ffb515c8bc033b4c0
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-grpb4 (#5727 follow-up 1, Group-B batch 4)

Migrates the two SETUP condition-polls in `cli.connections-4451.test.js` onto the shared
`eventually()` helper. Both POSITIVE, non-throwing, zero timeout-expecting (negative) waits, so
none is kept hand-rolled (Liu m5040; Liu m5247 ordered this file first and gave a care point about
its asserted time budgets).

## The two migratable waiters (and the protected budget regions left alone)
A whole-file false-negative hunt finds two migratable condition-polls:
- L153 `for (i<100 && !seen.some(POST))` -> `eventually(() => seen.some((q) => q.method === 'POST'), (v) => v, { timeoutMs: 5000, stepMs: 50 }).catch(() => {})`.
- L181 `for (i<100 && !readdirSync(tmp).some(kosmos-connect.))` -> `eventually(() => fs.readdirSync(tmp).some((f) => f.startsWith('kosmos-connect.')), (v) => v, { timeoutMs: 5000, stepMs: 50 }).catch(() => {})`.
Each old loop was 100 x 50ms = 5000ms, so the budget/step are byte-equal; each predicate is the old
`!cond` un-negated; `.catch(() => {})` preserves the old no-throw fall-through so the following
CONTROL assert stays the check.

LEFT UNTOUCHED (Liu m5247 care point 1 -- verified NOT in the diff): both `at = Date.now()` marks
and the `await new Promise(close-race w/ 6000ms SIGKILL)` + `const took = Date.now() - at` +
`assert.ok(took < 2000, ...)` that follow them; the stub `if (a && a.holdMs) await sleep(a.holdMs)`;
the `await sleep(300)` settle; the 20000ms run-helper hard-kill; the one-shot spawn/exec promises.

## Budget safety (the Liu m5247 proof)
BOTH migrated polls END BEFORE their test's `at = Date.now()` mark (line order: migrated poll L155
precedes `at` L159; migrated poll L184 precedes `at` L187). `took = Date.now() - at` measures only
the SIGTERM-to-child-close window AFTER the poll (whose wait is a one-shot close race, not a
condition-poll, and is untouched), so scaling the migrated setup polls (up to 4x) cannot change
`took`. The KOSMOS_TEST_TIME_SCALE=4 run confirms both `assert.ok(took < 2000)` still hold.

## Polarity audit (per Liu m5040) -- both positive, zero negative
Both wait for a condition to BECOME true (POST seen / private file exists) and the following CONTROL
assert checks exactly that. Neither is wrapped in assert.rejects or catch-as-success; neither
expects a timeout. ZERO negative waits.

## Swallowed-throw note (honest)
The probes are synchronous (`seen.some(...)`, `fs.readdirSync(tmp).some(...)`), the same reads the
old loop conditions made; a genuine probe throw would recur at the following CONTROL assert, so
`.catch` hides nothing, and the assert fails if the condition never held.

## Validation (Mortals, node v26.8.1), run-before-trust via the light lane (box busy with browser-checks)
`unset KOSMOS_AGENT_TOKEN && bash tools/queued-heavy.sh --light "..." node --test cli.connections-4451.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 5 tests, 5 pass, 0 fail, 0 cancelled, 0 not-ok, 0 timed-out.
- branch, scale 1: 5 / 5 / 0, 0 not-ok (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 5 / 5 / 0, 0 not-ok, 0 timed-out (the budget-safety check: a migrated poll inside a `took<2000` window would red here).
CI re-runs the whole suite on the head as the authoritative green-by-name gate.

## Challenge-loop ledger (1 blind pass, Sonnet) -- CONVERGED
No [BLOCKER], [WARNING], [CONVENTION] or [NIT]. The reviewer (blind to my conclusions) confirmed
exactly two condition-polls migrated and that the rest (stub holdMs, cli()/withStub wrappers, the
20000ms kill timer, the 300ms sleep, the two 6000ms SIGKILL fallbacks) are not condition-polls;
confirmed BOTH polls finish before their `at = Date.now()` (L159/L187) and that `took` is measured
from SIGTERM to the child's close event, so the poll's scaled duration cannot change it, with the
4x run confirming both `took < 2000` held; confirmed nothing between each `at` and its `took` assert
(and neither close-race / SIGKILL fallback) was touched; confirmed predicate polarity matches the
old loops and the CONTROL asserts still check the same events; confirmed `.catch` masks nothing (a
probe throw recurs at the CONTROL assert; a never-true event fails the assert); confirmed correct
helper use (5000ms/50ms matching the old loop, `(v) => v` over boolean probes). Independent runs:
5/5/0, exit 0, 0 not-ok, 0 timed-out, at default scale and KOSMOS_TEST_TIME_SCALE=4, both completed
(5 matches the file's tests). One minor non-finding: a 4x poll that times out waits up to 20000ms
before its CONTROL assert fails, but only when the test was already going to fail. No code change
was made.

## Subdir audit: passed
The changed test file sits at the repo root, governed by the project-wide root CLAUDE.md; `.claude/plans/`
has no CLAUDE.md; no directory was added.

## Origin classification
Every change is BRANCH-origin: one `eventually` require, two poll-line replacements (each with a
one-line comment), and the two plan files. No other file touched; no test added or removed (count
stayed 5).

The diff_hash is `git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`.
