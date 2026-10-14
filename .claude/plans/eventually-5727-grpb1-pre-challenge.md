---
method: challenge-loop
branch: eventually-5727-grpb1
diff_hash: cd862756fe5cded78503689b8a75d3a7f76a83b08aa66b5e1732c339deb107b8
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-grpb1 (#5727 follow-up 1, Group-B batch 1)

Migrates the ONE genuine condition-poll in the timing-sensitive `server.community-gate.test.js`
onto the shared `eventually()` helper. One waiter, POSITIVE liveness wait, zero
timeout-expecting (negative) waits, so none is kept hand-rolled (Liu m5040 standing rule).

## The one migratable waiter (and what the file otherwise contains)
In the `#4801 review 1` test, the mock community service captures a `release` resolver when the
held comment's POST reaches it, and the test polled for that:
`for (let i = 0; i < 400 && !release; i++) await new Promise((r) => setTimeout(r, 5))`
(count-based, 400 x 5ms = 2000ms). Migrated to
`await eventually(() => release, (v) => v, { timeoutMs: 2000, stepMs: 5 }).catch(() => {})`.
POSITIVE (waits for `release` to become set), NON-THROWING: the old loop fell through silently on
timeout and the next line `assert.ok(release, ...)` is the real check; `.catch(() => {})`
preserves that no-throw fall-through so the assert stays the check (start-reclaim / clitick
precedent). The probe `() => release` is a synchronous closure read and the predicate `(v) => v`
cannot throw, so the swallow can hide nothing but the helper's own timeout. The predicate is the
old `!release` condition seen un-negated. The rest of the file uses plain awaited HTTP calls; a
whole-file grep (setTimeout / Date.now / while / for ( / waitFor / setInterval / elapsed) finds
no other condition-poll.

## Timing safety (the run-before-trust point for a Group-B file)
Scaling the migrated wait (up to 4x) cannot shift any assertion: the test asserts no `Date.now()`
budget around this poll. After the wait it asserts `release` is set, issues a delete expecting
409 ("being sent right now"), calls `release()`, awaits the in-flight `sweeping`, then deletes
again expecting 200. None of those depends on how long the poll took. Scaling only gives the
stub's async POST longer to land; it is a measurement-read wait, never a budget-under-test.

## Polarity audit (per Liu m5040) -- positive, zero negative
The one migrated wait waits for `release` to BECOME set and the following assert checks exactly
that. Not wrapped in assert.rejects or catch-as-success; does not expect a timeout. ZERO negative
waits, so no waiter is kept hand-rolled.

## Validation (Mortals, node v26.8.1), run-before-trust
`unset KOSMOS_AGENT_TOKEN && node --test server.community-gate.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 23 tests, 23 pass, 0 fail, 0 cancelled, EXIT 0.
- branch, scale 1: 23 / 23 / 0, EXIT 0 (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 23 / 23 / 0, EXIT 0.
Zero `not ok` lines in every run. Count 23 unchanged across all three. CI re-runs the whole suite
on the head as the authoritative green-by-name gate.

## Challenge-loop ledger (1 blind pass, Sonnet) -- CONVERGED
No [BLOCKER], [WARNING] or [CONVENTION]. The reviewer (blind to my conclusions) grepped the whole
413-line file and confirmed exactly one wait-loop (the migrated one), nothing left behind;
confirmed the predicate waits for the same event in the same direction (release null -> set);
confirmed the `.catch(() => {})` can hide nothing but the helper's own timeout (probe and
predicate cannot throw) and that line-266 `assert.ok(release)` still fails the test if the POST
never arrived; confirmed nothing asserted depends on the wait duration (no elapsed-time check in
the file), so a scaled wait cannot change a result; confirmed correct helper use (positive,
millisecond units, 2000/5 matches the old 400 x 5ms, probes once before the deadline so an
already-set release returns immediately). Independent suite runs: 23/23/0, exit 0, zero `not ok`,
at scale 1 and at KOSMOS_TEST_TIME_SCALE=4. One [NIT]: the commit also adds the plan file, which
is the established practice for these batches (grpa2/grpa3 did the same; the pre-challenge-gate
hook expects the proof file). No code change was made.

## Subdir audit: passed
The changed test file sits at the repo root, governed by the project-wide root CLAUDE.md (not a
subdir delta); `.claude/plans/` has no CLAUDE.md; no directory was added.

## Origin classification
Every change is BRANCH-origin: one `eventually` require, one waiter-body replacement (two comment
lines), and the two plan files. No other file is touched; no test added or removed (count stayed 23).

The diff_hash is `git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`, as the
pre-challenge-gate hook recomputes it (base resolves to refs/remotes/origin/main).
