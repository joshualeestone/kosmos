---
method: challenge-loop
branch: eventually-5727-grpa2
diff_hash: 1d212ec65bd4ffb83b0c49cedec3c95e654cbf4ffa2e98ba9d2505922341a1b8
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-grpa2 (#5727 follow-up 1, Group-A batch 2)

Migrates three hand-rolled poll waiters, each a DIFFERENT shape, onto the shared `eventually()` helper.
All three are POSITIVE liveness waits; zero timeout-expecting (negative) waits, so none is kept
hand-rolled (Liu m5040 standing rule).

1. `server.startup.test.js` (#923): the startup-banner wait was a THROWING wall-clock while-loop.
   Migrated as a DIRECT delegate, no swallow (the remote.test.js precedent for a throwing loop):
   `eventually(() => /Kosmos on http/.test(stdout), (v) => v, { timeoutMs: 15000, stepMs: 50, describe: () => 'server did not report startup in time: ' + stdout })`.
   eventually throws on timeout exactly as the original did; `describe` reproduces the original
   diagnostic (stdout). One call site, positive.
2. `server.switch-arms-2238.test.js` (#2238): the `waitUntil(pred, ms)` helper was an
   already-wall-clock while-loop returning false on timeout. Its ONE caller (`assert.equal(await waitUntil(() => selfRestartCalls === 1), true, ...)`)
   asserts the result is true, so it is positive. Migrated as a boolean-preserving delegate:
   `eventually(() => pred(), (v) => v, { timeoutMs: ms, stepMs: 20 }).then(() => true).catch(() => false)`.
   The boolean contract is unchanged; the only shift is the deadline now scales (the intended #5727 refinement).
3. `cli.start-reclaim-4679.test.js` (#4679): a COUNT-based for-tick connect-poll (40 x 100ms). The probe
   is an ASYNC connection attempt; eventually awaits async probes (eventually.js:53). Migrated to
   `eventually(<async connect probe>, (v) => v, { timeoutMs: 4000, stepMs: 100 }).then(() => { listening = true; }).catch(() => {})`.
   The `.catch(() => {})` preserves the old no-throw behaviour (the loop fell through silently leaving
   listening=false); the following `assert.equal(listening, true, ...)` stays the real check. Count ->
   wall-clock is the accepted clitick/#6069 precedent, bounded by the [1,4] scale.

## Validation (Mortals, node v26.8.1)
`unset KOSMOS_AGENT_TOKEN && node --test server.startup.test.js server.switch-arms-2238.test.js cli.start-reclaim-4679.test.js`:
- baseline (origin/main content, pre-migration): 6 tests, 6 pass, 0 fail, 0 cancelled, EXIT 0.
- branch, scale 1: 6 / 6 / 0, EXIT 0 (identical to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 6 / 6 / 0, EXIT 0.
Count = 6 = server.startup 2 + switch-arms 3 + start-reclaim 1 (not cut short). CI re-runs the whole
suite on the head as the authoritative green-by-name gate.

## Polarity audit (per Liu m5040) -- all positive, zero negative
Every migrated wait waits for something to BECOME true and the test asserts on that success: the
startup banner appears; the deferred self-restart fired (selfRestartCalls === 1); the stub is
listening. None is wrapped in assert.rejects or catch-as-success, none expects a timeout. switch-arms's
false-return is mapped back exactly, so its single positive-assertion caller is byte-equivalent except
for the scaled deadline. ZERO negative waits, so no waiter is kept hand-rolled.

## Challenge-loop ledger (1 blind pass, Sonnet) -- CONVERGED
No [BLOCKER], [WARNING] or [CONVENTION]. The reviewer read eventually.js (confirmed it awaits the
probe, probes at t=0, checks the deadline after the probe, throws on timeout, scales ceil(timeoutMs*SCALE)
with SCALE clamped [1,4]), confirmed each predicate is the un-negated old condition, enumerated every
call site and confirmed all three positive (grep found no other callers of the migrated helpers),
confirmed the describe reproduces the old message, confirmed cadence (t=0 probe, step, budget)
preserved, and ran the three files: exit 0, tests 6 / pass 6 / fail 0, tests==6.
Two [NIT]s (no action, documented): (a) the `.catch(() => false)` in switch-arms could in theory hide a
throw from pred(), but pred is the comparison `selfRestartCalls === 1`, which cannot throw; (b) the
`.catch(() => {})` in start-reclaim could in theory hide a synchronous rejection from the connect probe
(e.g. an invalid port), but the port is a fixed variable and the socket 'error' event already maps to
false, and even then the failure is not silent because the `assert.equal(listening, true)` still fires.
Neither NIT changes behaviour for the actual inputs, so no change was made.

## Subdir audit: passed
The three changed test files sit at the repo root, governed by the project-wide root CLAUDE.md (not a
subdir delta); `.claude/plans/` has no CLAUDE.md; no directory was added.

## Origin classification
Every change is BRANCH-origin: three `eventually` requires, three waiter-body replacements, and the two
plan files. No other file is touched; no test added or removed.

The diff_hash is `git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`, as the
pre-challenge-gate hook recomputes it (base resolves to refs/remotes/origin/main).
