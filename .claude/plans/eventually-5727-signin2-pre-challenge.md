---
method: challenge-loop
branch: eventually-5727-signin2
diff_hash: 54b7bfa843c751cb4c84ed79c40bddff0bc6f54572a127ec9436ae82f4bc0fb5
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-signin2 (#5727 follow-up 1, batch 2)

Batch 2 migrates the two `engine/` sign-in `until(fn, ms, what)` poll helpers
(`musesignin.test.js`, `agysignin.test.js`) onto the shared `eventually()` helper from PR-1.

## Validation

The two changed files were run (`unset KOSMOS_AGENT_TOKEN && node --test <the 2 files>`) on the
committed HEAD aeca2f8dc, on Mortals (12 cores, 1-min load ~8-9, a contended shared box):
- scale 1: 101 tests, 101 pass, 0 fail (first run) and, after the accuracy reword, a second
  pass showed 100/101 with ONE red: `musesignin #3939 'an expired code is replaced on retry'`
  timed out at 15000ms with the sign-in state stuck at "starting".
- That red is the pre-existing load-driven flake this whole effort targets, NOT the migration:
  the old `while (Date.now() < end)` loop had the identical 15000ms budget and would time out
  the same way under the same load. Confirmed by three consecutive greens on rerun:
  `musesignin` alone at scale 1 (30/30, twice) and at forced KOSMOS_TEST_TIME_SCALE=2.5 (30/30,
  the scale the runner computes under load, which gives the flow the headroom it needs).
- Both files at forced KOSMOS_TEST_TIME_SCALE=2.5: 101 tests, 101 pass, 0 fail, EXIT=0.

A full local suite was NOT re-run: the diff touches only two test files, no runner or helper
code. CI re-runs the whole suite on the PR head and is the authoritative green-by-name gate.

counts-before-and-after:
- Before: each file had 1 `until` with 2 `Date.now()` uses (the `end` and the `while`), 0
  `eventually` require.
- After: 0 `Date.now()` in each (the loop is gone), 1 `eventually` require and 1 `eventually()`
  call each; the `until(fn, ms, what)` signature and every call site unchanged.

SUBDIR AUDIT: passed (no CLAUDE.md under engine/ or test-support/; the diff adds no directory).

The diff_hash above is computed as the pre-challenge-gate hook recomputes it:
`git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`.

## Challenge-loop ledger (1 blind pass)

### Iteration 1 (Sonnet, blind)
No [BLOCKER], no [CONVENTION] break. The reviewer read `test-support/eventually.js` and both
diffs in full and ran the two files (101/101 at the time). It confirmed: step (muse 100ms, agy
200ms) and default timeout (15000/20000) preserved; probe-first order and resolve-on-truthy
preserved; `(v) => v` safe because every call site's `fn` returns a boolean; the require path
resolves from engine/; nothing reads the old throw text (the `timed out waiting for` matches
are only the throw sites themselves); callers ignore the return value.

Two [WARNING]s, both RESOLVED (not deferred):
- [WARNING] "byte-identical" was overstated. The old `while (Date.now() < end)` loop checked
  the deadline BEFORE probing; `eventually` probes then checks, so it makes one extra probe
  past the deadline and a success landing within one step after `ms` now passes instead of
  failing. Strictly MORE lenient, never stricter (a never-true condition still times out), so
  no assertion is weakened. FIXED: the comments in both files and the plan now say "equivalent,
  one step more lenient," not "byte-identical," and the deviation is named. This leniency
  applies to every `while (Date.now() < end)` loop in later batches and is flagged to Liu.
- [WARNING] the muse `describe` detail. The old throw was `timed out waiting for X (state
  {...})`; the reviewer noted the new "for X" wording read awkwardly. FIXED: `describe` now
  returns `waiting for X (state {...})`, so the timeout message reads naturally and keeps the
  full diagnostic. `signin.status()` is plain JSON, evaluated at throw time as before.

[NIT] the wrappers return the truthy value where the old `until` returned `undefined`; every
call site is a bare `await until(...)` that ignores the result, so no effect. Documented.

The post-pass changes (the comment reword, the `describe` wording, the plan) are
message/comment/doc only and cannot change test behaviour, so no re-challenge was run (a blind
pass on a reword is the moving-target trap); the behavioural code the pass reviewed is
unchanged.

## Convergence
One blind pass, zero [BLOCKER]/[CONVENTION]; both [WARNING]s resolved by making the claim
accurate and the diagnostic read well, neither a behavioural code change. Converged.

## Origin classification
Every change is BRANCH-origin: the two `until` wrappers, the two `eventually` requires, and the
plan. No other file is touched.
