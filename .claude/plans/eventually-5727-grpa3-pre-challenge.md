---
method: challenge-loop
branch: eventually-5727-grpa3
diff_hash: 99b859f10d72c690d717e8716476209191481f8f753bddb799d3a2035fe7f537
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-grpa3 (#5727 follow-up 1, Group-A batch 3)

Migrates the ONE genuine condition-poll in the timing-sensitive `cli.busy-health-4466.test.js`
(#4466) onto the shared `eventually()` helper. One waiter, POSITIVE liveness wait, zero
timeout-expecting (negative) waits, so none is kept hand-rolled (Liu m5040 standing rule).

## The one migratable waiter (and what was left alone)
In the `#4466 one probe keeps to ONE budget` test, the stub writes a `.pageclose` marker file on
socket close, and the test polled for it:
`for (let i = 0; i < 40 && !fs.existsSync(closeFile); i++) await new Promise((r) => setTimeout(r, 50))`
(count-based, 40 x 50ms = 2000ms). Migrated to
`await eventually(() => fs.existsSync(closeFile), (v) => v, { timeoutMs: 2000, stepMs: 50 }).catch(() => {})`.
Positive (waits for the marker to appear), NON-THROWING: on timeout the old loop fell through silently
and the next line `assert.ok(fs.existsSync(closeFile), ...)` is the real check; `.catch(() => {})`
preserves that no-throw fall-through so the assert stays the check (the start-reclaim / clitick
precedent). The predicate is the old `!existsSync` condition seen un-negated.

LEFT UNTOUCHED (header L18-19: these ARE the behaviour under test): the stub `setTimeout(reply, delayMs)`
delays (health 'slow'/'oldslow'/'reporthang' arms), `setTimeout(() => process.exit(0), 50)`, the
`for...of` test-case iterations, the 3-wave `for (round < 3)` loop, the one-shot `await new Promise(...
listen/close/exit ...)` events, and the shell `sleep() { :; }` stub inside the code under test.

## Timing safety (the run-before-trust point for this budget-asserting file)
Scaling the migrated wait (up to 4x) cannot shift any assertion:
- `ended` is captured at L180 BEFORE the poll, so `ended - t0` (L197, `< 20000`) is unaffected.
- `pageBudgetMs = pageClose - first` (L193) is computed from the file CONTENTS (timestamps the stub
  wrote on its own clock), not from how long the poll took, so the `>= 5000` / `< 8500` asserts
  (L194/L195) are unaffected.
The poll only waits for the stub's async marker-file write to land before reading it; scaling it up on
a loaded box only reduces flakiness. It is a measurement-read wait, never a budget-under-test.

## Polarity audit (per Liu m5040) -- positive, zero negative
The one migrated wait waits for the `.pageclose` marker to BECOME present and the following assert
checks exactly that. Not wrapped in assert.rejects or catch-as-success; does not expect a timeout.
ZERO negative waits, so no waiter is kept hand-rolled.

## Validation (Mortals, node v26.8.1), run-before-trust
`unset KOSMOS_AGENT_TOKEN && node --test cli.busy-health-4466.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 54 tests, 54 pass, 0 fail, 0 cancelled, EXIT 0.
- branch, scale 1: 54 / 54 / 0, EXIT 0 (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 54 / 54 / 0, EXIT 0.
Zero `not ok` lines in every run. Count 54 unchanged across all three. CI re-runs the whole suite on
the head as the authoritative green-by-name gate.

## Challenge-loop ledger (1 blind pass, Sonnet) -- CONVERGED
No [BLOCKER], [WARNING], [CONVENTION] or [NIT]. The reviewer read the full diff (confirmed only the one
require + the one waiter replacement + comments/plan, nothing stray), read eventually.js (confirmed it
awaits the probe, probes at t=0, checks the deadline after the probe/pred, throws on timeout, scales
ceil(ms*SCALE) with SCALE clamped [1,4] so scale 1 == literal), confirmed the predicate is the
un-negated old condition and the budget is 2000ms either way, confirmed `.catch(() => {})` preserves the
no-throw fall-through and the assert stays the check, ran the false-negative hunt over the whole ~965-line
file (no other condition-poll; the stub setTimeout delays and one-shot event awaits correctly left alone),
confirmed the timing safety (ended and pageBudgetMs do not depend on the poll duration), and re-ran the
suite independently: tests 54 / pass 54 / fail 0, EXIT 0, zero `not ok`. No change was made.

## Subdir audit: passed
The changed test file sits at the repo root, governed by the project-wide root CLAUDE.md (not a subdir
delta); `.claude/plans/` has no CLAUDE.md; no directory was added.

## Origin classification
Every change is BRANCH-origin: one `eventually` require, one waiter-body replacement (two comment
lines), and the two plan files. No other file is touched; no test added or removed (count stayed 54).

The diff_hash is `git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`, as the
pre-challenge-gate hook recomputes it (base resolves to refs/remotes/origin/main).
