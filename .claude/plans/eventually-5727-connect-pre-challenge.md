---
method: challenge-loop
branch: eventually-5727-connect
diff_hash: 83ab0fa5b85fbc5f17af4bfb2b64b48bb9e9f606d70c0cca0fb4fb379a83e9ed
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-connect (#5727 follow-up 1, batch 3)

Batch 3 migrates `engine/connect.hookwiring-1569.test.js`'s `until(fn, ms=8000)` poll helper
onto the shared `eventually()` helper from PR-1. One file, one helper, two call sites.

## Validation

`unset KOSMOS_AGENT_TOKEN && node --test engine/connect.hookwiring-1569.test.js` on the
committed HEAD 70539e19d, on Mortals:
- scale 1 (byte-identical path): 1 test, 1 pass, 0 fail, 0 cancelled, 0 skipped, EXIT=0.
- forced KOSMOS_TEST_TIME_SCALE=2.5: 1 test, 1 pass, 0 fail, EXIT=0.
The file has exactly one test (`DOWNLOADING carries a zeroed progress ...`), which exercises
both `until` call sites, and it is not skipped, so the single pass genuinely exercises the
migrated helper. A full local suite was not re-run (one test file changed, no runner/helper
code); CI re-runs the whole suite on the PR head as the authoritative green-by-name gate.

counts-before-and-after: before, 1 `until` with a `Date.now() - t0 > ms` deadline and 0
`eventually` require; after, 0 `Date.now()` deadline in `until`, 1 `eventually` require, 1
`eventually()` call; the `until(fn, ms)` signature and both call sites unchanged.

SUBDIR AUDIT: passed (no CLAUDE.md under engine/ or test-support/; no directory added).

The diff_hash above is computed as the pre-challenge-gate hook recomputes it:
`git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`.

## Polarity audit (per Liu m4894)
Both call sites are POSITIVE waits, so the one-extra-probe concern does not even arise (and this
helper probes-then-checks anyway, so there is no extra probe):
- `:165` `await until(() => connect.state().phase === DOWNLOADING)`.
- `:186` `await until(() => (connect.state().progress || {}).got > 0)`.
No `assert.rejects`, catch-as-success, or expect-the-timeout use anywhere in the file.

## Challenge-loop ledger (1 blind pass)

### Iteration 1 (Sonnet, blind)
No [BLOCKER], no [WARNING], no [CONVENTION]. The reviewer read `test-support/eventually.js` and
the changed file in full, ran the file (1 pass / 0 fail), and confirmed each claim:
- Byte-identical at scale 1: probe-first then deadline (`> budget`, strict, matching the old
  `Date.now() - t0 > ms`), 20ms step passed explicitly, 8000ms default preserved,
  `scaleBudget(ms*1) === ms`. No extra probe past the deadline (unlike a `while`-loop helper).
- Swallow preserved: `try { return fn(); } catch { return false; }` matches the old
  `try { ok = fn() } catch { ok = false }`; eventually has no try around `await probe()`, so
  the wrapper is required and faithful.
- Polarity: both call sites positive; nothing expects the timeout.
- Throw text: the only `timed out waiting` matches are a prose comment and the (deleted) old
  throw; nothing asserts on it.

[NIT] (all harmless, no change): `await probe()` adds one microtask hop per probe (the `fn`s
are sync); the wrapper resolves with `true` where the old resolved `undefined` (both call sites
ignore the value); a promise-returning `fn` would now be awaited (both `fn`s are sync).

## Convergence
One blind pass, zero [BLOCKER]/[WARNING]/[CONVENTION]; the NITs are harmless and need no change.
A single byte-identical migration the reviewer verified line by line converges on the first
pass. No code changed after the pass, so the diff_hash is final.

## Origin classification
Every change is BRANCH-origin: the one `until` wrapper, the `eventually` require, and the plan.
No other file is touched.
