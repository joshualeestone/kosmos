---
method: challenge-loop
branch: eventually-5727-grpb2
diff_hash: e72c7fb3fe6ac55adfdf6dac4bce4a39d30a81ba4a263a1687eae87ee6cddc2b
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-grpb2 (#5727 follow-up 1, Group-B batch 2)

Migrates the four condition-polls in the timing-sensitive `server.disconnect-stop-2570.test.js`
onto the shared `eventually()` helper. All four POSITIVE liveness waits, zero timeout-expecting
(negative) waits, so none is kept hand-rolled (Liu m5040; Liu m5232 chose this file as Group-B
batch 2).

## The four migratable waiters (whole-file false-negative hunt)
A grep over the file (setTimeout / Date.now / while / for / setInterval / waitFor / sleep) finds
exactly four time-waits; the `for` loops (L45/L549/L701) are data/setup iterations, and the `sleep`
hits are inside the mock-binary shell strings (not polls).

1. #5994 openai login-state advance: `while (Date.now()-t0 < 4000 && state === 'starting')` ->
   `eventually(() => openai.chatgptLoginStatus(id).state, (s) => s !== 'starting', {timeoutMs:4000, stepMs:25}).catch(()=>{})`; assert `state === 'awaiting-browser'` stays the check.
2. #5994 openai slot drain (cleanup): `while (Date.now() < end && ourSlots().length)` ->
   `eventually(() => ourSlots(), (s) => s.length === 0, {timeoutMs:4000, stepMs:25}).catch(()=>{})`; assert `ourSlots() === []` stays the check.
3. #6000 grok userCode appears: `while (Date.now()-t0 < 4000 && !userCode)` ->
   `eventually(() => grok.grokLoginStatus(id).userCode, (c) => !!c, {timeoutMs:4000, stepMs:25}).catch(()=>{})`; assert `ok(...userCode)` stays the check.
4. #6000 grok slot drain (cleanup): same shape as (2), grok slots.

Each old loop fell through silently on its 4000ms timeout and the NEXT line's assert was the real
check, so `.catch(() => {})` preserves that no-throw fall-through (start-reclaim / clitick
precedent). Each predicate is the old loop condition un-negated; each keeps its 4000ms / 25ms.

## Timing safety (the Group-B run-before-trust point; Liu m5232 asked to flag budget-internal waits)
None of the four sits inside an asserted time budget. After each wait the test asserts a STATE or a
SET, never an elapsed bound: (1) state === 'awaiting-browser'; (2)/(4) ourSlots() === []; (3)
userCode truthy. No `Date.now()`-derived elapsed value is asserted near these waits, so scaling a
wait up to 4x only grants more time and cannot shift a result. Stronger still: the mock binaries
`exec sleep 30`, which outlives even the 16000ms (4x) budget, so a longer wait can never make a
still-running child look exited (the drain asserts would catch that regardless).

## Swallowed-throw note (honest)
The probes are synchronous reads (`chatgptLoginStatus`/`grokLoginStatus`, and a readdirSync-based
`ourSlots()`), the same calls the old while-conditions made. A genuine probe error would throw
again at the very next assertion (which calls the same function), so `.catch` hides nothing; if the
awaited event never happens, the following assert fails. Not reachable in normal operation.

## Polarity audit (per Liu m5040) -- all positive, zero negative
All four wait for a condition to BECOME true and the following assert checks exactly that. None is
wrapped in assert.rejects or catch-as-success; none expects a timeout. ZERO negative waits.

## Validation (Mortals, node v26.8.1), run-before-trust via the light lane (box busy with browser-checks)
`unset KOSMOS_AGENT_TOKEN && bash tools/queued-heavy.sh --light "..." node --test server.disconnect-stop-2570.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 35 tests, 35 pass, 0 fail, 0 cancelled, 0 not-ok.
- branch, scale 1: 35 / 35 / 0, 0 not-ok (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 35 / 35 / 0, 0 not-ok.
Count 35 unchanged across all three (matches the 35 top-level test() declarations). CI re-runs the
whole suite on the head as the authoritative green-by-name gate.

## Challenge-loop ledger (1 blind pass, Sonnet) -- CONVERGED
No [BLOCKER], [WARNING], [CONVENTION] or [NIT]. The reviewer (blind to my conclusions) grepped the
whole file and confirmed exactly four time-waits, all migrated, nothing hand-rolled left (L550 is
fixture-dir creation; the sleep hits are mock shell strings); confirmed each predicate matches the
old loop's direction (table of all four); confirmed `.catch(() => {})` hides nothing because a
genuine probe error re-throws at the next assertion that calls the same function, and the following
assert fails if the event never happens; confirmed no assertion depends on the wait duration and
that the `exec sleep 30` mocks outlive even the 4x budget; confirmed correct helper use (4000/25
matching the old loops, one harmless extra probe after the deadline). Independent suite runs:
35/35/0, exit 0, 0 not-ok, both at default scale and KOSMOS_TEST_TIME_SCALE=4, both completed (35
matches the 35 top-level test declarations). No code change was made.

## Subdir audit: passed
The changed test file sits at the repo root, governed by the project-wide root CLAUDE.md (not a
subdir delta); `.claude/plans/` has no CLAUDE.md; no directory was added.

## Origin classification
Every change is BRANCH-origin: one `eventually` require, four waiter-body replacements (each with
a two-line comment), and the two plan files. No other file touched; no test added or removed (count
stayed 35).

The diff_hash is `git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`, as the
pre-challenge-gate hook recomputes it (base resolves to refs/remotes/origin/main).
