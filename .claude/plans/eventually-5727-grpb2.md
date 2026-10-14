# eventually-5727-grpb2 (#5727 follow-up 1, Group-B batch 2)

Second Group-B batch of the #5727 tail: migrate the four condition-polls in
`server.disconnect-stop-2570.test.js` onto the shared `test-support/eventually.js` helper. All
four are POSITIVE liveness waits, zero timeout-expecting (negative) waits, so none is kept
hand-rolled (Liu's standing rule, m5040; Liu m5232 chose this file as Group-B batch 2).

## The four migratable waiters (all positive, all non-throwing)

A whole-file false-negative hunt (setTimeout / Date.now / while / for / setInterval / waitFor /
sleep) finds exactly these four time-waits; the `for` loops at L45/L549/L701 are data/setup
iterations, not time-polls.

1. **#5994 openai, L906-907 -- login-state advance.** `while (Date.now()-t0 < 4000 && status.state === 'starting')`
   waited for the openai login state to leave `'starting'`. Migrated to
   `eventually(() => openai.chatgptLoginStatus(id).state, (s) => s !== 'starting', { timeoutMs: 4000, stepMs: 25 }).catch(() => {})`.
   Following `assert.equal(..., 'awaiting-browser')` stays the check.
2. **#5994 openai cleanup, L927-928 -- slot drain.** `while (Date.now() < end && ourSlots().length)`
   waited for the killed child's work-slots to drain to empty. Migrated to
   `eventually(() => ourSlots(), (s) => s.length === 0, { timeoutMs: 4000, stepMs: 25 }).catch(() => {})`.
   Following `assert.deepEqual(ourSlots(), [])` stays the check.
3. **#6000 grok, L949-950 -- userCode appears.** `while (Date.now()-t0 < 4000 && !status.userCode)`
   waited for the grok device-code to be printed. Migrated to
   `eventually(() => grok.grokLoginStatus(id).userCode, (c) => !!c, { timeoutMs: 4000, stepMs: 25 }).catch(() => {})`.
   Following `assert.ok(...userCode)` stays the check.
4. **#6000 grok cleanup, L975-976 -- slot drain.** same shape as (2), grok slots.

Each old loop fell through silently on its 4000ms timeout and the NEXT line's assert was the real
check, so the `.catch(() => {})` preserves that no-throw fall-through (start-reclaim / clitick
precedent). Each predicate is the old loop condition seen un-negated. Count/while to wall-clock is
the accepted precedent, budget bounded by the [1,4] scale (each keeps its 4000ms / 25ms).

## Polarity audit (per Liu m5040) -- all positive, zero negative

All four wait for a condition to BECOME true (state advances, userCode appears, slots drain) and
the following assert checks exactly that. None is wrapped in assert.rejects or catch-as-success;
none expects a timeout. ZERO negative waits, so no waiter is kept hand-rolled.

## Time-budget check (Liu m5232: flag waits inside an asserted budget)

None of the four sits inside an asserted time budget. After each wait the test asserts a STATE or
a SET, never an elapsed-time bound: (1) state === 'awaiting-browser'; (2)/(4) ourSlots() === [];
(3) userCode truthy. No `Date.now()`-derived elapsed value is asserted anywhere near these waits,
so scaling the wait (up to 4x) only grants more time for the event and cannot shift any result.

## Swallowed-throw note (honest)

The probes are synchronous status reads (`chatgptLoginStatus`/`grokLoginStatus`) and a
`fs.readdirSync`-based `ourSlots()`; under a valid session inside the try-block they return values
rather than throwing, the same calls the old while-conditions made. If one ever threw, the old
loop threw too; with eventually the throw is swallowed by `.catch` and the following assert then
fails instead -- the test still fails, only the message differs. Not reachable in normal operation.

## File-overlap

`server.disconnect-stop-2570.test.js` has NO active sibling worktree touching it (checked
`git worktree list`). Per Liu m5232: orgchart-read-4559 is SKIPPED for now (Raiden reworks that
code for #4499); sandbox-4636 and roomhold-4624 stay deferred on active sibling worktrees.

## Validation (Mortals, node v26.8.1), run-before-trust via the light lane (box busy with browser-checks)

`unset KOSMOS_AGENT_TOKEN && bash tools/queued-heavy.sh --light "..." node --test server.disconnect-stop-2570.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 35 tests, 35 pass, 0 fail, 0 cancelled, 0 not-ok.
- branch, scale 1: 35 / 35 / 0, 0 not-ok (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 35 / 35 / 0, 0 not-ok.
CI re-runs the whole suite on the head as the authoritative gate.
