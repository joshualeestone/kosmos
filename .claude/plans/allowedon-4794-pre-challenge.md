---
pre_challenge: true
method: challenge-loop
branch: allowedon-4794
diff_hash: a827dc376f38b829175a512c8a2c6f0fa430335ee262ff6b4f1f46af2b4ef05e
validation: focused per round (engine/remote.test.js #4794 and list tests; both browser-check gates under bash -c); gated render-plus-panel-3829.js RUN on the converged head (0 FAIL) with a control (page line removed: exactly the five #4794 arms FAIL); the FULL suite runs on Mortals on this head, result in the PR
subdir_audit: not run (the diff changes no subdirectory CLAUDE.md)
timestamp: 2026-10-01T09:56:33Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes, at iteration 2 (no new BLOCKER, WARNING or CONVENTION after dedup)
**Total findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION (a non-finding), 6 NITs
**Fixed:** 2 (the WARNING and one NIT) | **Deferred:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [WARNING] docs/browser-checks/render-plus-panel-3829.js:363 - the meta lookup was keyed by display name and two rows share "Unknown device", so one row was never checked --> FIXED (e475d77b0: keyed by device id; d-mac and d-noname both required)
- [NIT] engine/remote.test.js:1033 - the long-name arm checked only the length --> FIXED (e475d77b0: asserts the first 60 characters)
- [NIT] engine/remote.js:1387 - slice(0, 60) can split a surrogate pair; matches the name line above
- [NIT] web/index.html:42967 - "allowed on <name>" beside a date could misread for a date-like name; copy is Mona's

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs after dedup, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (the slice NIT)
- [CONVENTION] web/index.html:42967 - reported NO em dash in the added copy --> DEFERRED: not a violation, the reviewer states compliance
- [NIT] web/index.html:42967 - askEsc covers the value; nothing to fix
- [NIT] docs/browser-checks/render-plus-panel-3829.js:361 - d-self is outside the arm; fine
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | docs/browser-checks/render-plus-panel-3829.js:363 | BRANCH | lookup keyed by a shared display name | FIXED | e475d77b0 |
| 2 | 2 | CONVENTION | web/index.html:42967 | BRANCH | states no em dash (compliance, not a defect) | DEFERRED | not a violation |

### NITs (non-blocking, across all iterations)
- [NIT] engine/remote.js:1387 - slice can split a surrogate pair (iterations 1 and 2)
- [NIT] web/index.html:42967 - copy could misread beside a date (iteration 1; Mona owns copy)
- [NIT] docs/browser-checks/render-plus-panel-3829.js:361 - d-self not in the arm (iteration 2)

### Strengths (across all iterations)
- allowed_on is escaped with askEsc before innerHTML; the engine refuses anything but a non-blank string (iteration 1)
- A tunnel without part C sends nothing and every layer reads exactly as before; the plain list test pins the null (iterations 1 and 2)
- Matches the contract Kitty accepted on #4794; the plan names what is out of scope and its weakest premise (iteration 2)
