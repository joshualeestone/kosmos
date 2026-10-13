---
pre_challenge: true
method: challenge-loop
branch: signupstale-3326
diff_hash: ec46af8a92cdcc43cf75a7224d29362d6f2b41dccf85d84eee29b83bfdb67297
validation: focused only (151/151 on HEAD 24472828f; full suite not run locally, the shared machine queue was 12 deep; CI runs it)
subdir_audit: passed
timestamp: 2026-10-13T09:44:13Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 2 WARNINGs, 0 BLOCKERs, 0 CONVENTIONs, 5 NITs
**Fixed:** 2 WARNINGs and 3 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

**Validation, stated exactly.** The 6.0 and 6j full-suite runs were queued behind 12 to 14 other
runs on the shared machine and stopped before they started; neither ran. What ran on each HEAD:
`server.connect.test.js`, `web.firstrun-model.test.js` and the file-scanning guards
(cli.sandbox-data-4796, engine.reachable, engine/win32-separator-guard,
engine/windows-coupling-audit-1732, engine/windows-tests-1777, fixture-discipline,
no-brand-refs-1881, no-name-refs-3071): 151/151, exit 0. The change is tests and a plan only, with no
product code. The full suite is left to the PR's CI, and the PR merges only on green CI.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] server.connect.test.js:509 - the post-launch "never finished connected" snapshot could not fail (every wrong finish needs several 700 ms ticks) --> FIXED (24472828f): the assertion is removed
- [WARNING] .claude/plans/signupstale-3326.md:31 - the plan claimed the tests prove sign-up "never reads connected", resting on that snapshot --> FIXED (24472828f): the plan now states only the first-response phase and the launch argv
- [NIT] plan:21 - "#3646" did not say it was the PR that removed the #3367 probe gate --> FIXED (24472828f)
- [NIT] plan:15 - "10/10" did not name the command or the set --> FIXED (24472828f)
- [NIT] web.firstrun-model.test.js:351 - a deepEqual on the whole body breaks if an unrelated field is added --> FIXED (24472828f): reauth and installConfirmed checked separately

After the fixes, both failure checks were redone: drop `reauth` from the route and the UNVERIFIABLE and LIVE arms fail; drop `reauth: true` from the page and the page test fails. Tree restored clean each time.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 0
- [NIT] server.connect.test.js:493 - the launch-poll loop now appears three times; a helper is optional
- [NIT] plan - the "shown failing" claims cannot be checked from the diff alone (the reviewer checked the logic they rest on and found it consistent)
- The reviewer's CONVENTION line reported no violation (no em dashes, the plan present), so it is not counted as a finding
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | server.connect.test.js:509 | BRANCH | post-launch snapshot could not fail | FIXED | 24472828f |
| 2 | 1 | WARNING | .claude/plans/signupstale-3326.md:31 | BRANCH | plan overstated what the tests pin | FIXED | 24472828f |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] plan:21 - #3646 reference made precise (iteration 1, fixed)
- [NIT] plan:15 - measured set named (iteration 1, fixed)
- [NIT] web.firstrun-model.test.js:351 - body check loosened to the two fields (iteration 1, fixed)
- [NIT] server.connect.test.js:493 - poll loop duplicated three times (iteration 2, left as is to match the sibling tests)
- [NIT] plan - shown-failing claims not checkable from the diff (iteration 2, recorded here instead)

### Strengths (across all iterations)
- The UNVERIFIABLE arm is the discriminating one: its no-reauth twin is the existing #1585 CONTROL, so the pair pins both halves (iterations 1 and 2)
- The page test evaluates the real request body after stripping comments, so a comment or `reauth: false` cannot satisfy it (iterations 1 and 2)
- Cleanup matches the sibling tests exactly, all in `finally` (iterations 1 and 2)
