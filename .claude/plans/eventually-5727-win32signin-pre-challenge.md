---
method: challenge-loop
branch: eventually-5727-win32signin
diff_hash: b65a38df5292fa4c336f401bb80be61519fdd2fce6fd1ae1c4db5545c618e46c
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-win32signin (#5727 follow-up 1, batch 4)

Batch 4 migrates `engine/connect.win32signin.test.js`'s `until(fn, ms)` poll helper (the
`setInterval` form, 30 `await until(` call sites) onto the shared `eventually()` helper. First
of the two big-call-site connect files; `connect.test.js` (~90 sites) follows.

## Validation

`unset KOSMOS_AGENT_TOKEN && node --test engine/connect.win32signin.test.js` on the committed
HEAD 5fbdb08a, on Mortals:
- scale 1 (equivalent path): 19 tests, 19 pass, 0 fail, 0 cancelled, 0 skipped, EXIT=0.
- forced KOSMOS_TEST_TIME_SCALE=2.5: 19 tests, 19 pass, 0 fail, EXIT=0.
The 30 call sites live across these 19 tests. A full local suite was not re-run (one test file
changed, no runner/helper code); CI re-runs the whole suite on the PR head as the authoritative
green-by-name gate.

counts-before-and-after: before, 1 `until` (setInterval deadline loop), 30 `await until(`
sites, 0 `eventually` require; after, 0 setInterval in `until`, 1 `eventually` require, 1
`eventually()` call; the `until(fn, ms)` signature and all 30 call sites unchanged.

SUBDIR AUDIT: passed (no CLAUDE.md under engine/ or test-support/; no directory added).

The diff_hash above is computed as the pre-challenge-gate hook recomputes it:
`git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`.

## Polarity audit (per Liu m4894) -- all call sites POSITIVE
Every `await until(...)` waits for a phase or a spawn/kill count to be REACHED, then the test
proceeds; a timeout fails the test. None proves an absence, none is `assert.rejects` /
catch-as-success, none expects the timeout. The three `try` blocks around an `until` (lines
~241, ~296, ~420) are try/FINALLY cleanup (`cancel()` / `clearInterval`), NOT catch-as-success.
Independently re-verified by the blind pass, which enumerated the call sites and confirmed each
positive. So the t=0-extra-probe leniency (below) is safe and no call site is pulled off
`eventually()`.

## Equivalent at scale 1, one extra probe at t=0 (strictly more lenient, positive-only)
The old `setInterval(fn, 10)` first fired at t=10ms; `eventually` probes at t=0, so it checks
once sooner. For a positive wait that can only succeed sooner, strictly more lenient, never
stricter. A thrown `fn()` still propagates (eventually awaits the probe with no catch, as the
old `reject(e)` did). 10ms step and the `ms || 3000` default preserved. Only the throw text
changes, and nothing asserts on it.

## Challenge-loop ledger (1 blind pass)

### Iteration 1 (Sonnet, blind)
No [BLOCKER], no [WARNING], no [CONVENTION]. The reviewer read `test-support/eventually.js` and
the changed file in full, ran the file (19/19 pass), and confirmed: 10ms step / `ms||3000`
default / resolve-on-truthy carried over; a thrown `fn()` propagates; the only differences are
the t=0 extra probe (more lenient, positive-only) and the throw text; ALL call sites positive
(enumerated) and the three try blocks are try/finally; `(v) => v` safe (predicates are booleans,
and line ~465's `connect.state().url` is a truthy-when-ready string); nothing asserts on the old
throw text; `connect.state()` is a safe synchronous getter at throw time and `describe` is
wrapped in try/catch by the helper.

[NIT] (acted on): the describe initially printed ONLY the phase, which would lose `because` /
`url` on a red for the two compound waits that key on `because` (lines ~449, ~468) -- a phase-only
red there could read as "the phase was right" while hiding the real miss. FIXED: `describe` now
leads with the phase (Sonya's readability tip, m4899) and then appends the whole state the old
throw dumped, so nothing in the diagnostic is lost. This is a throw-MESSAGE-only change
(describe runs only on a timeout failure, and nothing asserts on it), so it cannot change test
behaviour; the blind pass's behavioural findings still hold.

[NIT] (no change): two timing-equivalence details (deadline checked only after a falsy probe in
both; the new loop is sequential vs fixed-rate, which can only probe slightly LATER under load,
never earlier). Both harmless for positive waits.

## Convergence
One blind pass, zero [BLOCKER]/[WARNING]/[CONVENTION]. The only post-pass change is the
message-only describe improvement addressing an iter-1 NIT; it cannot regress behaviour.
Converged.

## Origin classification
Every change is BRANCH-origin: the one `until` wrapper, the `eventually` require, and the plan.
No other file is touched.
