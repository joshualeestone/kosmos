---
method: challenge-loop
branch: eventually-5727-grpb5
diff_hash: 359b4dab633f9c2f376ff9f830ef743523ae3308111e5818fbdb9a63088050b5
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-grpb5 (#5727 follow-up 1, Group-B batch 5)

Migrates the two BOTH-IN-FLIGHT concurrency-gate condition-polls in
`server.provider-accounts-3296.test.js` onto the shared `eventually()` helper. Both POSITIVE,
non-throwing, zero timeout-expecting (negative) waits, so none is kept hand-rolled (Liu m5040;
Liu m5247 ordered this file second, after connections-4451, before remote-tick, with care point 2
about the both-in-flight waits).

## The two migratable waiters
A whole-file false-negative hunt finds two migratable condition-polls:
- L215 `for (i < 100 && entered < 2) ... sleep(20)` -> `eventually(() => entered, (n) => n >= 2, { timeoutMs: 2000, stepMs: 20 }).catch(() => {})`.
- L311 `for (i < 100 && entered < 1) ... sleep(20)` -> `eventually(() => entered, (n) => n >= 1, { timeoutMs: 2000, stepMs: 20 }).catch(() => {})`.
Each old loop was 100 x 20ms = 2000ms, so budget/step are byte-equal; each predicate is the old
continuation condition un-negated (`entered < 2` -> `n >= 2`, `entered < 1` -> `n >= 1`). The
require was added after `const { start, server } = require('./server');`.

LEFT UNTOUCHED (not condition-polls): the two `for...of` loops over the fixed `['gemini','grok']`
provider list; the `Date.now()` used to build a past mtime (not a wait); the `await gate` barrier +
`release()`; the `Promise.all([p1, p2])` joins; the `fs.readdirSync(SANDBOX)` slot inspections.

## Liu m5247 care point 2 (the non-vacuous proof)
Each migrated wait is IMMEDIATELY followed by its CONTROL assert (L219 `assert.equal(entered, 2,
'CONTROL: ...')`; L317 `assert.equal(entered, 1, 'CONTROL: ...')`). So the swallowed timeout is NOT
vacuous: if the gate never reaches 2 (or 1), `eventually` times out, `.catch` swallows, and the
CONTROL assert on the next line FAILS. The non-throwing swallow is therefore correct; the assert is
the check, exactly as the old non-throwing loop left it.

## No asserted time budget around these polls
Neither poll sits inside a `const at = Date.now(); ...; assert(took < X)` window (the file has no
`Date.now() - start` timing assertion). They are setup gates feeding the CONTROL assert; after each
the test releases the gate and inspects which sandbox slots the concurrent adds claimed. Scaling the
polls (up to 4x) changes no asserted value, confirmed by the scale-4 run (23/23/0). The only scale-4
effect is a longer worst-case FAILURE time (up to 8s), and only when the test was already failing.

## Polarity audit (per Liu m5040) -- both positive, zero negative
Both wait for the counter to REACH a threshold (entered >= 2 / >= 1) and the following CONTROL
assert checks exactly that. Neither is wrapped in assert.rejects or catch-as-success; neither
expects a timeout. ZERO negative waits.

## Swallowed-throw note (honest)
The probe `() => entered` is a synchronous closure read of a test-local counter; it cannot throw.
A gate that never reaches the threshold times out rather than throwing, `.catch` swallows, and the
CONTROL assert on the next line fails. So `.catch` hides nothing.

## Validation (Mortals, node v26.8.1), run-before-trust via the full-claim queued-heavy lane
Box cleared after the 0.7.48 staging all-clear, so each leg ran uncontended under its own machine
claim (the light lane could not get a clean run during the freeze -- it refuses beside a release
cut). `unset KOSMOS_AGENT_TOKEN && node --test server.provider-accounts-3296.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 23 tests, 23 pass, 0 fail, 0 cancelled, 0 not-ok, 0 timed-out.
- branch, scale 1: 23 / 23 / 0, 0 not-ok, 0 timed-out (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 23 / 23 / 0, 0 not-ok, 0 timed-out.
CI re-runs the whole suite on the head as the authoritative green-by-name gate.

## Challenge-loop ledger (1 blind pass, Sonnet) -- CONVERGED
No [BLOCKER], [WARNING], [CONVENTION] or [NIT]. The reviewer (blind to my conclusions)
independently determined: exactly TWO condition-polls (original L215, L311), both migrated;
each predicate the old loop's un-negated continuation with the 2000ms budget = 100 x 20ms, the
20ms step, and no off-by-one; the two `for...of` loops over the fixed provider list and the
`Date.now()` mtime builder are not polls and were correctly left alone, with no other waits in the
file; both waits POSITIVE (no negative migrated); neither poll inside an asserted time window (the
file has no `Date.now() - start` assertion), so the only 4x effect is a longer worst-case failure
time; the `.catch` swallow NON-vacuous (CONTROL asserts at L219/L317 fail if the gate never held);
the probe `() => entered` a synchronous closure read that cannot throw; the require placed correctly
after the `./server` import; test count unchanged; no behavior change beyond the two loop
replacements. Verdict: behavior-preserving and safe.

HONEST NOTE on the reviewer's run: the reviewer could NOT execute the suite -- another agent's
`tools/run-tests.sh` (pid 14405) had held the box for ~2h43m, so the full-claim lane queued behind
5 waiters and the light lane refused ("queue's bound ran out"). who-has-the-box reported no release
cut. The reviewer declined to pass KOSMOS_HARNESS_IGNORE_SUITE=1 (I instructed it not to collide).
So the DYNAMIC confirmation is my own run-before-trust above (23/23/0 at baseline/scale1/scale4 on
the full-claim lane, which completed before that long suite started), plus CI as the authoritative
whole-suite gate on the head. The static review converged with zero findings.

## Subdir audit: passed
The changed test file sits at the repo root, governed by the project-wide root CLAUDE.md;
`.claude/plans/` has no CLAUDE.md; no directory was added.

## Origin classification
Every change is BRANCH-origin: one `eventually` require, two poll-line replacements (each with a
two-line comment), and the two plan files. No other file touched; no test added or removed (count
stayed 23).

The diff_hash is `git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`.
