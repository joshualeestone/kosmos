---
pre_challenge: true
method: challenge-loop
branch: skills-sandbox-3801
diff_hash: 3bf313945da388d538e3162815b619879bcec9dfc00585b4de0f267d78100456
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T02:05:09Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 7 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs)
**Fixed:** 2 (plus 1 NIT) | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: yarn test on HEAD 8e876e873, 9641 tests, 9489 pass, 0 fail, 152 skipped (validation-log hash 3bf313945da3). Run after release 0.6.95 released the machine; heavy-run gate clear twice, 60s apart.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] tools.browser-checks-skills-3801.test.js:87 — the with-lib board test could not fail if the lib's skills seal broke, because the engine seal also covered it (data in temp) --> FIXED (62d2278e4): that arm now uses real-looking data so only the lib seal protects it. Control measured: deleting the lib's skills line reds exactly the two lib tests; disabling the engine seal reds exactly the engine test.
- [WARNING] .claude/plans/skills-sandbox-3801-20260925-201608.md:25 — plan promised an Add arm with an mtime check that no test exercised --> FIXED (62d2278e4): every arm now POSTs /api/skills; fixture arms assert the Add did not land in the home, Remove found nothing, and the home skills folder mtime is unchanged; CONTROL asserts Add really writes into a non-fixture home.
- [NIT] engine/skills.js:34 — comment said the fixture folder "does not exist", but Add creates it --> FIXED (8e876e873)
- [NIT] tools/browser-checks.sh:253 — RUN_DIR/skills shared across a run's checks (latent; no check writes skills)
- [NIT] docs/browser-checks/lib-sandbox-home.js:50 — sandbox folders share the kosmos-bc-home- prefix
- [NIT] tools.browser-checks-skills-3801.test.js:28 — real-looking dirs under the repo assume the checkout is not under a temp root
- [NIT] tools.browser-checks-skills-3801.test.js:123 — runner test is a source regex, not behavioural

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools.browser-checks-skills-3801.test.js:87 | BRANCH | with-lib arm masked by engine seal | FIXED | 62d2278e4 |
| 2 | 1 | WARNING | .claude/plans/skills-sandbox-3801-20260925-201608.md:25 | BRANCH | Add arm promised, not tested | FIXED | 62d2278e4 |

### NITs (non-blocking, across all iterations)
- [NIT] engine/skills.js:34 — "does not exist" comment (iteration 1, fixed 8e876e873)
- [NIT] tools/browser-checks.sh:253 — shared RUN_DIR/skills per run (iteration 1)
- [NIT] docs/browser-checks/lib-sandbox-home.js:50 — sandbox folder prefix (iteration 1)
- [NIT] tools.browser-checks-skills-3801.test.js:28 — checkout under temp root assumption (iteration 1)
- [NIT] tools.browser-checks-skills-3801.test.js:123 — regex-over-source runner test (iteration 1)

### Strengths (across all iterations)
- Three independent seals (lib, runner, engine), each proven by its own arm (iterations 1, 2)
- Reuses status.sandboxIsInconsistent() rather than a new heuristic; required lazily (iterations 1, 2)
- CONTROL arms prove the exposure is real and non-fixture boards are unchanged (iteration 1)
- Plan names its weakest part; commit messages record the os.homedir() sweep (iteration 1)
