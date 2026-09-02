---
pre_challenge: true
method: challenge-loop
branch: model-change-arms-1484
diff_hash: 7d38a2a5ae21775fdcb406890d1e35c95fddef1ef79d77862c407093d2503f27
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T03:12:54Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 produced zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 5 (0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 3 NITs)
**Fixed:** 3 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Validation note
The shared validation helper routes lockfile-less kosmos to pnpm and fails closed; workaround
per the standing convention is to pin the JS runner to yarn after sourcing
(`_vlog_js_runner() { echo yarn; }`). With that pin, `validation_log_run_or_skip` PASSED on the
6.0 baseline (hash 76c10907e7c1) and again after the iteration-2 fixes (hash 7d38a2a5ae21); the
6j final gate SKIPPED (clean entry already recorded for the converged hash). The kosmos suite's
non-hermetic tests are orthogonal here: this branch touches only docs/browser-checks/ (a Playwright
check script + a README row + this plan), no app code, so the app suite cannot be affected by it.

### Browser verification
The browser check itself (`render-model-change.js`) was run in a browser on both new arms on
2026-09-01 19:55 CDT on a sandboxed board (fixture homes removed one at a time, page reloaded
between passes): rc=0, no FAIL, and planted defects made each new assertion go red. web/index.html
(the surface under test) is unchanged since that base, so that verification still holds after the
rebase onto current main. The iteration-2 addition is a single NEGATIVE assertion on the
one-account arm; it is guaranteed to pass given the 19:55 run's confirmed positive (the one-account
arm renders web/index.html:23983 "runs on THE sign-in shown above", which does not contain the
fallthrough string "runs on this computer's OpenAI sign-in" at :24017). Playwright is not installed
in this checkout, so the added negative was verified by that logical argument plus source analysis
rather than a fresh browser run.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] render-model-change.js:350 — the `!/you picked/` and `!/computer chooses/` negatives guard
  strings absent from any reachable sentence today. --> superseded by the iteration-2 WARNING and
  addressed there.
- [NIT] render-model-change.js:300-302 — `switchSentence` uses a one-shot `#firstrun` check without
  the initial nav's settle. --> DEFERRED: safe by `firstrun.complete()` (line 110) suppressing
  first-run on reload; any failure would be loud (a timeout), not a silent false pass; adding a
  fixed `waitForTimeout` would reintroduce the timeout-not-signal anti-pattern the rest of the
  check deliberately avoids.
- CONVENTION (missing plan file) --> FIXED (b350e83a): wrote the plan file
  model-change-arms-1484-20260901.md before the loop.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 0 NITs
- [WARNING] render-model-change.js:350 — the one-account arm had no guard against the REAL
  reachable fallthrough it could collapse into ("runs on this computer's OpenAI sign-in.",
  web/index.html:24017); the zero arm guarded it, the one arm did not, so the historical-defect
  negatives gave more confidence than they earned. --> FIXED (db095f36): added
  `!/runs on this computer.s OpenAI sign-in\./.test(one.small)` to the one-account block, symmetric
  with the zero arm, with a comment distinguishing it from the historical guards.
- [CONVENTION] plan file:5 — two em dashes in the plan file I wrote (no-em-dash rule applies to all
  output, plan files included). --> FIXED (db095f36): replaced with commas.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] render-model-change.js:350 — the combined negative still mixes the one meaningful sub-term
  (`!/There is not one yet/`) with two decorative historical-defect ones; reviewer confirms it is
  "harmless and disclosed" (the comment at lines 353-358 says so and the real guard is at line 359).
  --> DEFERRED: the two historical negatives are documented regression guards for the two specific
  false sentences that shipped before; kept intentionally, and the load-bearing fallthrough guard is
  now present.
**Converged** — no new actionable findings; the sole NIT is the already-disclosed harmless redundancy.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | render-model-change.js:350 | historical negatives can't fire on a reachable sentence | (superseded) | escalated + fixed at iter 2 |
| 2 | 1 | NIT | render-model-change.js:300-302 | one-shot firstrun check, no settle | DEFERRED | safe by firstrun.complete(); loud not silent; fixed-timeout would be an anti-pattern |
| 3 | - | CONVENTION | .claude/plans/ | no plan file for branch | FIXED | b350e83a |
| 4 | 2 | WARNING | render-model-change.js:350 | one-account arm missing the real fallthrough guard | FIXED | db095f36 |
| 5 | 2 | CONVENTION | plan:5 | em dashes in the plan file | FIXED | db095f36 |
| 6 | 3 | NIT | render-model-change.js:350 | redundant decorative negatives (disclosed) | DEFERRED | documented historical guards; real guard present at line 359 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] render-model-change.js:300-302 — one-shot firstrun check (iter 1) — DEFERRED (safe)
- [NIT] render-model-change.js:350 — decorative historical negatives (iter 1, re-noted iter 3) — DEFERRED (documented)

### Strengths (across all iterations)
- Every wait names a real signal (`ACCOUNTS_LOADED === true`, picker settled to shown-with-rows-or-hidden, modal shown with non-empty text), never a fixed timeout for state; no race (fill is synchronous from the already-loaded in-memory list).
- Destructive fixture teardown is correct and guaranteed by position: both `fs.rmSync` run after every two-account assertion; one-account (needs 1) precedes zero (needs 0); no later assertion needs two accounts; deletions reuse the single FIXTURES source of truth.
- Assertions pin the real current sentences and the negatives separate the four dialog arms; the load-bearing fallthrough negatives are genuinely reachable in both arms; the picker real-space checks are asymmetric and complete (one-account requires a rendered box, zero requires box === null).
- The `.` (not `\.`) for the curly apostrophe in "computer's" is a deliberate, correct choice against the app's U+2019.
- Coverage is genuinely new: the source-level regex test inspects the expression, never its rendered use, which is exactly why both arms shipped false before.
- No em dashes in render-model-change.js, the README line, or (after the iter-2 fix) the plan file.
