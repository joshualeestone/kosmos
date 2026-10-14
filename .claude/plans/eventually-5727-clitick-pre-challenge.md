---
method: challenge-loop
branch: eventually-5727-clitick
diff_hash: 50f4ee4ea890859367466fa2b2dc3c583b04f02fde9d1a45baca328d88b785f9
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-clitick (#5727 follow-up 1, Group-A cli.* tick waiters)

Migrates the one count-based for-tick waiter in each of six root `cli.*.test.js` files onto the
shared `eventually()` helper: `cli.agent-token-verbs-4491` (`send`), `cli.presents-board-token-1968`
(`drive`), `cli.presents-token` (`report`), `cli.react-2255` (`react`), `cli.reply-token-3769`
(`reply`), `cli.token-off-argv-1970` (inline). Each loop `for (i < 100 && <cond>) sleep 50` becomes
`await eventually(<negated cond>, (v) => v, { timeoutMs: 5000, stepMs: 50 }).catch(() => {})`, plus a
`require('./test-support/eventually')`. First Group-A batch under the #6069 precedent (Liu m5040).

## Validation
`unset KOSMOS_AGENT_TOKEN && node --test <the six files>` on Mortals (node v26.8.1):
- baseline (git stash, origin/main content): 82 tests, 82 pass, 0 fail, 0 cancelled, 0 skipped, EXIT=0.
- branch, scale 1: 82 / 82 / 0, EXIT=0 -- identical to baseline.
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 82 / 82 / 0, EXIT=0.
The blind reviewer re-ran the six at scale 1 independently: 82 / 82 / 0 (0 fail, 0 cancelled). CI
re-runs the whole suite on the PR head as the authoritative green-by-name gate.

counts-before-and-after: before, 6 count-based for-tick loops, 0 `eventually` require. After, 6
`eventually().catch()` calls, 6 `eventually` requires; no test added or removed (the 82-test total is
identical before and after), and no assertion edited.

SUBDIR AUDIT: passed. The changed `cli.*` files sit at the repo root, governed by the project-wide
root CLAUDE.md (not a subdir delta); `.claude/plans/` has no CLAUDE.md; no directory added.

The diff_hash is `git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`, as the
pre-challenge-gate hook recomputes it (base resolves to refs/remotes/origin/main).

## Polarity audit (per Liu m5040) -- every call site POSITIVE, zero negative
All call sites wait for the stub to record the CLI's request (`seen`/`seen[which]` grows), then the
test asserts on what landed; the stub records an entry for every request that reaches the route, so
`seen` grows even for the token-drop/refusal cases (what those cases check is the recorded entry's
header value, not the absence of a request). Callers: `send` x8, `drive` x9, `report` x4, `react` x4,
`reply` x3, plus the one inline wait in the 1970 file. None expects the wait to time out, none is
wrapped in `assert.rejects` or a catch-as-success. The react helper has no assertion of its own; its
callers assert on `out`, and the react stub pushes to `seen` on every POST (including the `ok:false`
refusal), so the wait always lands; the missing-argument and curl-failure tests do not call `react`.
So no call site is kept hand-rolled. (Standing rule: a future negative use added to any of these
helpers must keep its own loop.)

## The `.catch(() => {})` swallow (preserves the old no-throw behaviour)
Unlike remote.test.js's `until` (which threw via `assert.fail`), these loops exited SILENTLY after
100 ticks and let the FOLLOWING assertion be the check. `eventually` throws on timeout, so the swallow
makes a timeout a no-op and the assertion below (`assert.equal(seen...length, before + 1, ...)`, or the
caller's assertion for `react`) still fires with its original message on a genuine never-landed
request. The `.catch` absorbs ONLY eventually's own timeout rejection: each probe is a synchronous
property read of an in-scope array, so it cannot throw for any other reason, so the swallow hides no
real defect. This is the batch-3 hookwiring precedent for a non-throwing loop.

## Equivalence: count -> wall-clock (the accepted precedent), bounded
Same shape Liu accepted on #6069: the old loop was COUNT-based (100 iterations), accidentally
load-adaptive but unbounded; `eventually`'s deadline is explicit and bounded by KOSMOS_TEST_TIME_SCALE
(capped 4x). At scale 1 unloaded the real durations match (~5000ms); under the runner the scaled
budget tracks load; stricter than the old count loop only under a bare `node --test` scale-1 on a
loaded box (the targeted scenario). Both probe at t=0 (the old loop checks its guard before the first
sleep) with a 50ms step preserved.

## Challenge-loop ledger (1 blind pass, Sonnet)
No [BLOCKER], [WARNING] or [CONVENTION]. The reviewer read `eventually.js` and all six helpers,
confirmed each probe is the exact negation of its old guard, confirmed the swallow preserves the
no-throw behaviour and hides no other throw (synchronous-read probes), enumerated every caller and
confirmed all positive (the `undefined`-header assertions check a landed request, not an absent one;
react's refusal case still records to `seen`), confirmed `(v) => v` truthiness and the t=0 / 50ms /
5000ms cadence, confirmed nothing else changed, and ran the six files (82/82, 0 fail/0 cancelled).
[NIT] (no action): a genuine timeout can run a step or two past 5000ms before eventually throws (old
loop: exactly 100 ticks); the `.catch` makes this invisible, and under scale > 1 the stretch is the
intended behaviour.

## Convergence
One blind pass, zero BLOCKER/WARNING/CONVENTION, no changes needed. Converged.

## Origin classification
Every change is BRANCH-origin: six helper bodies, six `eventually` requires, and the two plan files.
No other file is touched.
