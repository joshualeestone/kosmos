# eventually-5727-grpb3 (#5727 follow-up 1, Group-B batch 3)

Third Group-B batch of the #5727 tail: migrate the two condition-polls in
`server.grok-subscription-3391.test.js` onto the shared `test-support/eventually.js` helper. Both
POSITIVE, zero timeout-expecting (negative) waits, so none is kept hand-rolled (Liu m5040; Liu
m5232 placed this file as Group-B batch 3, after disconnect-stop-2570).

## The two migratable waiters (whole-file false-negative hunt)

A grep over the file (setTimeout / Date.now / while / for / setInterval / waitFor / sleep / new
Promise) finds exactly two time-waits; the `for` loops (L110 labels, L124 n-in-1..3, L163
remove-in-false/true) are data iterations, not time-polls.

### 1. The `poll` helper (L59) -- THROWING, returns a value -> direct delegate (no swallow)
The reusable `poll(sessionId, want, ms=5000)` fetched the subscription status over HTTP each tick,
returned `{status, body}` when `want(body)` held, and THREW `'timed out; last: ' + JSON.stringify(b)`
on the ms deadline. Migrated to a direct eventually() delegate that keeps the throw and the return
shape:
```js
return eventually(
  async () => { const r = await fetch(statusUrl); return { status: r.status, body: await r.json() }; },
  (res) => want(res.body),
  { timeoutMs: ms, stepMs: 50, describe: (res) => 'last: ' + JSON.stringify(res.body) },
);
```
It still THROWS on timeout (the remote.test.js / server.startup throwing-helper precedent: no
`.catch` swallow), still returns `{status, body}` (callers use `.body` / `.status`), and `describe`
reproduces the old "last body" diagnostic in eventually's throw message. ALL THREE call sites are
POSITIVE (L75 wait for userCode, L78 wait for state==='connected', L193 wait for
state==='connected'||'error') -- each awaits the returned value; none is wrapped in assert.rejects
or relies on the timeout throw. So keeping it throwing is faithful and no call site is a negative.

### 2. The L142 pending-clear loop -- non-throwing -> `.catch` swallow
`while ((fs.existsSync(pendingDir) || grokAccounts.isSignInPending(...)) && Date.now() < until)`
waited for a cancelled sign-in's pending state to CLEAR. Migrated to
`eventually(() => fs.existsSync(pendingDir) || grokAccounts.isSignInPending(...), (pending) => !pending, { timeoutMs: 5000, stepMs: 50 }).catch(() => {})`.
Positive (wait for pending to become false), non-throwing: the old loop fell through on timeout and
the next line `assert.equal(fs.existsSync(pendingDir), false, ...)` is the real check, which the
`.catch(() => {})` preserves. Predicate is the old condition un-negated.

## Polarity audit (per Liu m5040) -- both positive, zero negative
Waiter 1 waits for `want(body)` (all three call sites positive); waiter 2 waits for pending to
clear. Neither is wrapped in assert.rejects or catch-as-success; neither expects a timeout. ZERO
negative waits, so no waiter is kept hand-rolled.

## Time-budget check (Liu m5232: flag waits inside an asserted budget)
Neither waiter sits inside an asserted time budget. The `poll` callers assert on the returned
body's fields (userCode / state / account), never on elapsed time; the L142 caller asserts
`existsSync(pendingDir) === false`. No `Date.now()`-derived elapsed value is asserted near either
wait, so scaling (up to 4x) only grants more time and cannot shift a result.

## Swallowed-throw note (honest, waiter 2 only)
Waiter 1 does NOT swallow (direct throwing delegate). Waiter 2's probe is sync
(`fs.existsSync` + `grokAccounts.isSignInPending`), the same calls the old while-condition made; a
genuine probe throw would recur at the following `assert.equal(fs.existsSync(pendingDir), ...)`, so
`.catch` hides nothing, and the assert fails if pending never cleared.

## File-overlap
`server.grok-subscription-3391.test.js` has NO active sibling worktree touching it. Per Liu m5232:
orgchart-read-4559 SKIPPED (Raiden reworks that code for #4499); sandbox-4636 and roomhold-4624
stay deferred on active sibling worktrees.

## Validation (Mortals, node v26.8.1), run-before-trust via the light lane (box busy with browser-checks)
`unset KOSMOS_AGENT_TOKEN && bash tools/queued-heavy.sh --light "..." node --test server.grok-subscription-3391.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 9 tests, 9 pass, 0 fail, 0 cancelled, 0 not-ok, 0 timed-out.
- branch, scale 1: 9 / 9 / 0, 0 not-ok (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 9 / 9 / 0, 0 not-ok, 0 timed-out.
CI re-runs the whole suite on the head as the authoritative gate.
