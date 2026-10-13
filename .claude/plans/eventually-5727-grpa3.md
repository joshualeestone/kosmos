# eventually-5727-grpa3 (#5727 follow-up 1, Group-A batch 3)

Third Group-A batch of the #5727 tail: migrate the one genuine condition-poll in the
timing-sensitive `cli.busy-health-4466.test.js` onto the shared `test-support/eventually.js`
helper. One waiter, POSITIVE liveness wait, zero timeout-expecting (negative) waits, so none is
kept hand-rolled (Liu's standing rule, m5040).

## The one migratable waiter

`cli.busy-health-4466.test.js` (#4466) is SLOW ON PURPOSE (~2 min): its header (lines 18-19) warns
that the stub `setTimeout(reply, delayMs)` delays (health 'slow'/'oldslow'/'reporthang'/'cutthendie'
arms) ARE the behaviour under test (20 s / 12 s / 15 s budgets), so those must NOT be migrated. The
`for...of` loops iterate test-case arrays, and the `await new Promise(... listen/close/exit ...)` calls
are one-shot event awaits. The ONE genuine condition-poll is in the `#4466 one probe keeps to ONE
budget` test:

    const closeFile = firstFile + '.pageclose';
    for (let i = 0; i < 40 && !fs.existsSync(closeFile); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.existsSync(closeFile), '...');

A count-based for-tick poll (40 x 50ms = 2000ms) waiting for the stub's ASYNC `.pageclose` marker file
to be written (the stub writes it on socket close). It is POSITIVE (wait for the file to appear) and
NON-THROWING: on timeout the loop falls through silently and the NEXT line
`assert.ok(fs.existsSync(closeFile), ...)` is the real check. Migrated to:

    await eventually(() => fs.existsSync(closeFile), (v) => v, { timeoutMs: 2000, stepMs: 50 }).catch(() => {});

The `.catch(() => {})` preserves the old no-throw fall-through so the assert below stays the check
(the start-reclaim / clitick precedent). Count -> wall-clock is the accepted precedent, bounded by the
[1,4] scale.

## Why scaling this wait shifts no measured budget (the run-before-trust point)

This file asserts time budgets, so the key question is whether scaling the migrated wait can move any
measurement. It cannot:
- `ended` is captured at line 180 BEFORE this poll, so `ended - t0` (line 197) is unaffected.
- `pageBudgetMs = pageClose - first` (line 193) is computed from the file CONTENTS (timestamps the
  stub wrote on its own clock), not from how long the poll took, so the `>= 5000` / `< 8500` asserts
  (194/195) are unaffected.
This poll only waits for the stub's async marker-file write to land before reading it (line 188
comment). Scaling it UP (on a loaded box) only reduces flakiness; it is a measurement-read wait, never
a budget-under-test.

## Polarity audit (per Liu m5040)

The one migrated wait is a positive liveness wait: it waits for the `.pageclose` marker to appear and
the following assert checks exactly that. It is not wrapped in assert.rejects or catch-as-success and
does not expect a timeout. ZERO negative waits, so no waiter is kept hand-rolled.

## File-overlap

`cli.busy-health-4466.test.js` has NO active sibling worktree touching it (checked `git worktree list`:
the installgrep-4466 worktree is a different file). The other remaining Group-A files stay deferred:
cli.sandbox-4636 (branches sandbox-4636, sandbox-4636-rb active) and server.roomhold-idle-4624 (branch
roomhold-4624 active) still have sibling worktrees modifying those exact files.

## Validation (Mortals, node v26.8.1), run-before-trust

`unset KOSMOS_AGENT_TOKEN && node --test cli.busy-health-4466.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 54 tests, 54 pass, 0 fail, 0 cancelled, EXIT 0.
- branch, scale 1: 54 / 54 / 0, EXIT 0 (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 54 / 54 / 0, EXIT 0.
Zero `not ok` lines in every run. CI re-runs the whole suite on the head as the authoritative gate.
