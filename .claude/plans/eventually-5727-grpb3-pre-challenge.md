---
method: challenge-loop
branch: eventually-5727-grpb3
diff_hash: 69946cd83d2ed693843d85706542b307dcaf264aae05edfd2d449fa1053c5ddc
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-grpb3 (#5727 follow-up 1, Group-B batch 3)

Migrates the two condition-polls in `server.grok-subscription-3391.test.js` onto the shared
`eventually()` helper. Both POSITIVE, zero timeout-expecting (negative) waits, so none is kept
hand-rolled (Liu m5040; Liu m5232 placed this file as Group-B batch 3).

## The two migratable waiters (whole-file false-negative hunt)
A grep (setTimeout / Date.now / while / for / setInterval / waitFor / sleep / new Promise) finds
exactly two time-waits; the `for` loops (labels, n in 1..3, remove in false/true) are data
iterations.

### 1. The `poll(sessionId, want, ms=5000)` helper -- THROWING, returns {status, body}
Previously looped, returned `{status, body}` when `want(body)` held, and threw
`'timed out; last: ' + JSON.stringify(b)` on the ms deadline. Migrated to a DIRECT eventually()
delegate (the remote.test.js / server.startup throwing-helper precedent, NO `.catch` swallow):
the probe fetches and returns `{status, body}`, the pred is `(res) => want(res.body)`, and
`describe: (res) => 'last: ' + JSON.stringify(res.body)` reproduces the old last-body diagnostic in
eventually's throw. Still throws on timeout; still returns `{status, body}`. ALL THREE call sites
are POSITIVE (wait for userCode / state==='connected' / state==='connected'||'error'); each awaits
the returned value; none is in assert.rejects or relies on the throw, so keeping it throwing is
faithful and no call site is a negative.

### 2. The L142 pending-clear loop -- non-throwing -> `.catch` swallow
`while ((fs.existsSync(pendingDir) || grokAccounts.isSignInPending(...)) && Date.now() < until)`
waited for a cancelled sign-in's pending state to clear. Migrated to
`eventually(() => fs.existsSync(pendingDir) || grokAccounts.isSignInPending(...), (pending) => !pending, { timeoutMs: 5000, stepMs: 50 }).catch(() => {})`.
Positive; the next line `assert.equal(fs.existsSync(pendingDir), false, ...)` stays the check and
the `.catch` preserves the old no-throw fall-through. Predicate is the old condition un-negated.
Note (reviewer-confirmed, not a regression): the following assert only checks the `existsSync`
half, exactly as before the change; the `isSignInPending` half was never asserted by this test.

## Polarity audit (per Liu m5040) -- both positive, zero negative
Waiter 1 (all 3 call sites) and waiter 2 wait for a condition to BECOME true. Neither is wrapped in
assert.rejects or catch-as-success; neither expects a timeout. ZERO negative waits.

## Time-budget check (Liu m5232: flag waits inside an asserted budget)
Neither waiter sits inside an asserted time budget. The poll callers assert on the returned body's
fields (userCode / state / account); the L142 caller asserts existsSync(pendingDir)===false. No
`Date.now()`-derived elapsed value is asserted near either wait, so scaling (up to 4x) only grants
more time and cannot shift a result.

## Swallowed-throw note (honest, waiter 2 only)
Waiter 1 does NOT swallow (direct throwing delegate). Waiter 2's probe is sync (fs.existsSync +
isSignInPending), the same calls the old while-condition made; a genuine probe throw would recur at
the following assert, so `.catch` hides nothing and the assert fails if pending never cleared.

## Validation (Mortals, node v26.8.1), run-before-trust via the light lane (box busy with browser-checks)
`unset KOSMOS_AGENT_TOKEN && bash tools/queued-heavy.sh --light "..." node --test server.grok-subscription-3391.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 9 tests, 9 pass, 0 fail, 0 cancelled, 0 not-ok, 0 timed-out.
- branch, scale 1: 9 / 9 / 0, 0 not-ok (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 9 / 9 / 0, 0 not-ok, 0 timed-out.
Count 9 unchanged across all three (matches the 9 top-level test() declarations). CI re-runs the
whole suite on the head as the authoritative green-by-name gate.

## Challenge-loop ledger (1 blind pass, Sonnet) -- CONVERGED
No [BLOCKER], [WARNING], [CONVENTION] or [NIT]. The reviewer (blind to my conclusions) confirmed
exactly two time-waits, both migrated (the other for-loops are data iteration); the new `poll`
returns the same {status, body} shape (callers read only `.body.*`, all work); `poll` has no
`.catch` so a timeout still throws, all three call sites are positive, and the error message text
(which no test asserts) is the only change, with `describe` keeping the diagnostic; the predicate
applies `want` to the body as before; waiter 2's predicate waits for pending to clear and its
`.catch` only covers the existsSync half exactly as the old assert did (not a regression); no
assertion depends on elapsed time; helper args/budgets (5000ms/50ms) match the old loops.
Independent suite runs: 9/9/0, exit 0, 0 not-ok, 0 timed-out, at default scale and
KOSMOS_TEST_TIME_SCALE=4, both completed (9 matches the 9 top-level test declarations). No code
change was made.

## Subdir audit: passed
The changed test file sits at the repo root, governed by the project-wide root CLAUDE.md (not a
subdir delta); `.claude/plans/` has no CLAUDE.md; no directory was added.

## Origin classification
Every change is BRANCH-origin: one `eventually` require, two waiter migrations (the poll helper
body and the L142 loop), and the two plan files. No other file touched; no test added or removed
(count stayed 9).

The diff_hash is `git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`, as the
pre-challenge-gate hook recomputes it (base resolves to refs/remotes/origin/main).
