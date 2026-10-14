# eventually-5727-grpb1 (#5727 follow-up 1, Group-B batch 1)

First Group-B batch of the #5727 tail: migrate the one genuine condition-poll in
`server.community-gate.test.js` onto the shared `test-support/eventually.js` helper. One
waiter, POSITIVE liveness wait, zero timeout-expecting (negative) waits, so none is kept
hand-rolled (Liu's standing rule, m5040).

## The one migratable waiter

In the `#4801 review 1: while a comment's POST is out, the delete route answers 409` test, the
mock community service captures a `release` resolver the moment the held comment's POST reaches
it (the handler holds the request open). The test polled for `release` to become set with a
count-based loop:

    const sweeping = communitysend.sweep();
    for (let i = 0; i < 400 && !release; i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(release, 'CONTROL: the comment\'s POST reached the service');

A count-based for-tick poll (400 x 5ms = 2000ms) waiting for the stub's async POST to land.
POSITIVE (wait for `release` to appear) and NON-THROWING: on timeout the loop falls through
silently and the NEXT line `assert.ok(release, ...)` is the real check. Migrated to:

    await eventually(() => release, (v) => v, { timeoutMs: 2000, stepMs: 5 }).catch(() => {});

The `.catch(() => {})` preserves the old no-throw fall-through so the assert below stays the
check (the start-reclaim / clitick precedent). The probe `() => release` is a synchronous
closure-variable read, so the swallow hides no other throw. The predicate is the old `!release`
condition seen un-negated. Count -> wall-clock is the accepted precedent (Liu m5040), bounded by
the [1,4] scale.

## Why scaling this wait shifts no measured budget (the run-before-trust point)

This is a Group-B (timing-sensitive) file, so the key question is whether scaling the migrated
wait can move any assertion. It cannot: the test asserts no `Date.now()` budget around this
poll. After the wait it asserts `release` is set, issues a delete expecting 409 ("being sent
right now"), calls `release()`, awaits the in-flight `sweeping`, then deletes again expecting
200. None of those depends on how long the poll took. The poll only waits for the stub's async
POST to land before the control assertion reads it; scaling it up on a loaded box only reduces
flakiness.

## Polarity audit (per Liu m5040)

The one migrated wait is a positive liveness wait: it waits for `release` to BECOME set and the
following assert checks exactly that. It is not wrapped in assert.rejects or catch-as-success and
does not expect a timeout. ZERO negative waits, so no waiter is kept hand-rolled. The file has
exactly one poll-loop of this shape (grep confirmed).

## File-overlap

`server.community-gate.test.js` has NO active sibling worktree touching it (checked
`git worktree list`: no worktree matches this file or its card family). The remaining Group-A
files stay deferred (cli.sandbox-4636, server.roomhold-idle-4624 still have sibling worktrees).

## Validation (Mortals, node v26.8.1), run-before-trust

`unset KOSMOS_AGENT_TOKEN && node --test server.community-gate.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 23 tests, 23 pass, 0 fail, 0 cancelled, EXIT 0.
- branch, scale 1: 23 / 23 / 0, EXIT 0 (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 23 / 23 / 0, EXIT 0.
Zero `not ok` lines in every run. CI re-runs the whole suite on the head as the authoritative gate.
