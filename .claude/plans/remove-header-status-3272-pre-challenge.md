---
pre_challenge: true
method: challenge-loop
branch: remove-header-status-3272
diff_hash: 839f2d60a997139923f7be8eaea6e410ebbabf1e89fae3281efb2036f8a6572d
validation: passed
subdir_audit: passed
timestamp: 2026-09-18T20:44:15Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

Card #3271 (Josh, 2026-09-18): the agent-detail header kept showing a status/reason line #d-why
(.detail-why) that rendered `a.because` ("Finished responding.") under the agent name. Josh: "there's
not supposed to be anything up there around what their status is getting reported ... we don't want a
status line up there. They keep popping back in." This removes #d-why (element + render + .detail-why
CSS), reversing #3043 (Josh's own 2026-09-14 request, now reversed by him), and LOCKS the removal so
the recurrence stops. Rides a later build (not the demo build).

**Iterations:** 4 (1 validation + 3 blind reviews, alternating opus/sonnet)
**Converged:** Yes (iteration 4, opus, found zero BLOCKER/WARNING)
**Total findings:** 1 BLOCKER (6.0 surface gate), 2 WARNING, 2 CONVENTION, 3 NIT
**Fixed:** 5 | **Deferred:** 3 | **Asked:** 0

The recurrence mechanism was itself a pair of tests enforcing #3043 (a #d-why render test + a
relocation assertion), so a naive removal failed CI and got reverted. The durable fix inverts those
into a guard that reds if a reason line is re-added, plus a runtime browser-check backstop.

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** n/a
**New findings:** 1 BLOCKER (synthetic)
**Self-generated:** 0
- [BLOCKER] #2518 surface gate: web/index.html comments named the token `d-reauth`, which
  render-reauth-reach-1918.js is surface-mapped to, so the gate flagged it as an un-updated surface -->
  FIXED (fa57de8e5): reworded the two web comments to drop the literal token; my change does not touch
  d-reauth. (Also corrected card citations #3272 -> #3271 in 45a9ee803.) Origin BRANCH.

#### Iteration 2 (blind review)
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 1 WARNING, 1 NIT
**Self-generated:** 0
- [WARNING] docs/browser-checks/README.md:291 -- the render-detail-header-1841 row still described the
  #d-why relocation as current --> FIXED (5e2c940ea). Origin BRANCH (old line made stale by the removal).
- [NIT] branch/plan filename say "3272" (card is #3271) --> DEFERRED (cosmetic; the plan filename must
  match the branch for the loop's `*${BRANCH}*` lookup; all in-code citations are #3271).

#### Iteration 3 (blind review)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 1 WARNING, 1 NIT
**Self-generated:** 0
- [WARNING] render-detail-header-1841.js:18-20 -- the top-of-file JSDoc "five parts" summary still said
  Part 3 relocates to #d-why, contradicting the fixed inline Part 3 --> FIXED (ab120d881). Origin BRANCH.
- [NIT] web/index.html ~15188/24985 historical "panel carries explanation" comments --> DEFERRED
  (pre-existing, not in the diff, historical rationale, not a live #d-why claim; editing = scope creep).

#### Iteration 4 (blind review)
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0
**Converged** -- no actionable BLOCKER/WARNING. Reviewer independently confirmed: no self-contradicting
doc survives, the removal is clean with no dangling ref/null-deref, kept surfaces render, the lock is
red-capable + non-vacuous, card citations #3271, no em dash added.
- [CONVENTION] plan filename lacks -timestamp suffix --> DEFERRED (timestampless plans exist in-repo;
  the gate keys on `<branch>-pre-challenge.md`, not the plan name).
- [NIT] the static guard regexes matched only double quotes --> FIXED (e2962522c): made quote-agnostic
  and added a querySelector arm; proven red-capable on a single-quoted re-add. Aligns with the "lock it
  in" intent.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html (comments) | BRANCH | #2518 surface gate fired on a d-reauth comment mention | FIXED | fa57de8e5 |
| 2 | 2 | WARNING | docs/browser-checks/README.md:291 | BRANCH | stale README: #d-why relocation as current | FIXED | 5e2c940ea |
| 3 | 2 | NIT | branch/plan filename | n/a | "3272" vs card #3271 | DEFERRED | cosmetic; branch-glob |
| 4 | 3 | WARNING | render-detail-header-1841.js:18-20 | BRANCH | stale JSDoc header: relocation as current | FIXED | ab120d881 |
| 5 | 3 | NIT | web/index.html:15188/24985 | BRANCH | historical "panel carries explanation" | DEFERRED | out of scope, historical |
| 6 | 4 | CONVENTION | plan filename | n/a | no -timestamp suffix | DEFERRED | gate keys on proof name |
| 7 | 4 | NIT | server.test.js:3291 | SELF | guard quote-specific | FIXED | e2962522c |

### Validation
- Full `run-tests.sh` PASSED (hash 839f2d60a997); node suite 3363 tests / 0 fail; subdir audit clean.
- render-detail-header-1841.js browser-check green: Part 3 asserts whyExists:false through REAL openDetail,
  keeping the #d-task rate_limited "usage limit" assertion. web.quoted-line-986.test.js green (d-task noQuote
  derivation unchanged).
- The lock is dual: a static red-capable guard in server.test.js (element/class/paint, quote-agnostic, with
  a kept-surfaces control) + the runtime browser-check.

### Deferred (with reasoning)
- Plan/branch "3272" vs card #3271: cosmetic; the plan filename must contain the branch name for the loop's
  lookup; every in-code citation is #3271.
- web/index.html:15188/24985 historical comments: pre-existing, not in the diff, historical rationale (not a
  live #d-why claim); editing them is scope creep.

### Strengths
- The lock is genuinely red-capable and non-vacuous (proven by reverting), guarded two independent ways
  (static source + runtime openDetail), directly implementing Josh's "lock it in".
- Removal clean and complete: element, CSS, and render paint all gone, no dangling ref/null-deref; kept
  surfaces (#d-meta/#d-said/#d-task/#d-state/re-auth) intact.
- Every touched doc/comment/test narrates the two-step history (#3043 added, #3271 removed) rather than
  rewriting it; no self-contradiction survives; no em dash added.

### Weakest premise
Josh's "no status line up there" is categorical, so #d-why is removed ENTIRELY, which also drops the
non-reported "why we cannot vouch" reason (#569). If Josh wants that specific reason back on a surface, it
is a small follow-up (a fresh surface, not a #d-why re-add). Documented in the plan.
