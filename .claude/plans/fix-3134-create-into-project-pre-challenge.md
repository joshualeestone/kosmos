---
pre_challenge: true
method: challenge-loop
branch: fix-3134-create-into-project
diff_hash: 13a84d77675c15c01b71c5289ffec98c9beb0a2d7b00719cd3a44895829fb81f
validation: passed
subdir_audit: passed
timestamp: 2026-09-16T23:54:47Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 7 (2 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 2 NITs)
**Fixed:** 6 | **Deferred:** 0 | **Asked (awaiting user):** 0
(1 NIT deliberately left as non-blocking, verified correct.)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 2 BLOCKERs, 1 WARNING, 1 CONVENTION
**Self-generated:** 0 of the above (nothing committed by the loop yet; the initial branch commit is the work under review, not a loop fix)
- [BLOCKER] initial-validation: browser-check gate (#1720) failed -- web/ change with no docs/browser-checks/ assertion updated --> FIXED (browser-check rewrite, same fix as below)
- [BLOCKER] docs/browser-checks/render-pjcreate-nav-3134.js — pre-existing check (from 6.68 PR #3160) asserts the OLD return-to-list behaviour, so it now asserts the wrong thing and fails on this branch --> FIXED: rewritten to assert the new project's detail is shown after Create (tab + consolidated), fallback arm unchanged. Ran locally via the pinned PW runtime: passes on this branch, fails on the 6.68 behaviour (non-vacuous negative control run).
- [WARNING] .claude/plans/fix-3134-create-into-project.md — plan's Tests section omitted the browser-check, which is why the stale check went unnoticed --> FIXED: plan now names the browser-check and the rewrite.
- [CONVENTION] commit 11e787c9c — subject not in the repo's `<branch> -- <message>` format --> FIXED: amended to `fix-3134-create-into-project -- ...`.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** the iteration-1 browser-check + tests confirmed correct.
- [CONVENTION] .claude/plans/fix-3134-create-into-project.md — filename lacks the `-<timestamp>` suffix CLAUDE.md prescribes --> FIXED: renamed to `fix-3134-create-into-project-20260916.md` (and em dashes removed from the body).
- [NIT] web.add-project.test.js:76 — handler slice relies on the first column-0 `});` being the handler's own close; verified correct today and mitigated by the doesNotMatch guard --> left as-is (non-blocking, verified).

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [NIT] docs/browser-checks/render-pjcreate-nav-3134.js:106 — comment referenced a plan "Verification section" that does not exist, and described the pre-#3160 pjById-in-handler shape --> FIXED: comment corrected (openProject's own internal pjById check now drives the fallback).
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | (6.0 validation) | BRANCH | #1720 browser-check gate: web/ change, no browser-check updated | FIXED | browser-check rewrite |
| 2 | 1 | BLOCKER | docs/browser-checks/render-pjcreate-nav-3134.js | BRANCH | asserts the 6.68 return-to-list behaviour (now wrong) | FIXED | rewritten for 6.70, run locally (pass + non-vacuous) |
| 3 | 1 | WARNING | .claude/plans/...md | BRANCH | plan Tests omitted the browser-check | FIXED | plan updated |
| 4 | 1 | CONVENTION | commit 11e787c9c | SELF | subject not `<branch> -- <message>` | FIXED | amended |
| 5 | 2 | CONVENTION | .claude/plans/...md | BRANCH | filename missing `-<timestamp>` | FIXED | renamed to -20260916 |
| 6 | 2 | NIT | web.add-project.test.js:76 | BRANCH | handler-slice robustness | LEFT | verified correct, guard mitigates |
| 7 | 3 | NIT | docs/browser-checks/render-pjcreate-nav-3134.js:106 | BRANCH | stale comment cross-reference | FIXED | comment corrected |

### NITs (non-blocking, across all iterations)
- [NIT] web.add-project.test.js:76 — handler-slice depends on the first flush-left `});`; verified correct, mitigated by the doesNotMatch guard (iteration 2).

### Strengths (across all iterations)
- The core change is a clean, minimal revert-forward to the proven pre-#3160 behaviour: one `openProject(newProjectId)` call carries both the happy path (opens + lights the new project's detail) and the read-back-failure path (its own `pjMarkOpen(null)` + `pjView('list')` with the "could not read it back" notice), so no navigation path was lost (iterations 1, 2, 3).
- The `pjMarkOpen(null)` count change (7 -> 6) is independently verified: exactly 6 call sites remain, and the create handler is no longer a return-to-list close path (iterations 1, 2, 3).
- The source guard in web.add-project.test.js is non-vacuous: its `doesNotMatch(/pjView('list')/)` fails against the prior 6.68 source (iterations 1, 2, 3).
- The rewritten browser-check correctly encodes the tab/consolidated asymmetry (list hidden in tab, kept as the rail in consolidated) and uses the strong `#pj-one-name === <new project>` assertion; run locally, it passes on this branch and fails on the 6.68 behaviour (iterations 1, 2, 3).
- Create and Save flows are consistent: both land the person inside the project; no stale test asserts the superseded 6.68 behaviour; user-facing copy uses commas, no em dashes (iterations 2, 3).
