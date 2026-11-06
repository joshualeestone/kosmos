---
pre_challenge: true
method: challenge-loop
branch: glm-7206b
diff_hash: 45641cd6fd70ffeb4b8467d1ff096b17fc08c3e95803b08cdb107dd80592b01f
validation: passed (Mortals full suite, 27518 tests, 0 fail, base 2eb410b251)
subdir_audit: passed
timestamp: 2026-11-06T05:02:03Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 raised NITs only)
**Total findings:** 4 actionable (1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs), plus 1 validation failure, and 10 NITs
**Fixed:** 4 findings + the validation failure | **Deferred:** 0 actionable (NITs listed below) | **Asked (awaiting user):** 0

6.0 baseline: the full suite was started on Mortals at the first head and stopped once iteration 1 found a BLOCKER (a new head was needed anyway; nothing recorded). The local guards (engine.reachable, #1732, #1777, fixture-discipline, orgpolicy names, reason-grep, browser-checks-wired, remotestepup, #2129, and both browser-check gates) passed before iteration 1.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (no loop fix commit existed yet)
- [BLOCKER] web/index.html acctCompatShow: a vendor change with the form open kept the typed key, so a DeepSeek key could be posted under vendor glm (to Z.ai's check), and the reverse. Confirmed by the reviewer in a browser. --> FIXED (iteration 1 commit): a vendor change clears the key and the name, as acctApikeyShow does.
- [WARNING] docs/browser-checks/render-glm-add-7206.js: the "DeepSeek after GLM" arm reopened the modal first, so it could not see the BLOCKER. --> FIXED: an arm with no reopen (switch with a key typed, assert empty and nothing posted); red on the previous head.
- [WARNING] web/index.html add handler: an add in flight during a vendor change left Add disabled (its finally checks the generation). --> FIXED: a new visit re-arms Add.
- [NIT] web/index.html compatAsk: the answer comment still said true/false. --> fixed in the same commit
- [NIT] web/index.html: the block comment above COMPAT_ON described DeepSeek alone. --> fixed in the same commit
- [NIT] web/index.html frPaintCompat: rows took the connectable 'on' style. --> fixed (only 'off' is toggled now)
- [NIT] web/index.html paintKeyedProviderOptions: the typeof COMPAT_ON_FOR guard. --> left: it keeps the function runnable where tests lift it without the global.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the WARNING cites the iteration-1 re-arm line, a CODE line, fixed normally)
- [WARNING] web/index.html acctCompatShow: re-arming Add on every show let a same-vendor re-pick during a check enable a second post of the same key. --> FIXED (iteration 2 commit): only a vendor change (or putting the form away) starts a new visit (generation, clearing, re-arm); a re-pick of the open vendor keeps the add in flight. Browser check arm added, red on the previous head (2 failures).
- [NIT] two clearing paths in acctCompatShow could merge. --> merged in the same commit
- [NIT] three comments said "the DeepSeek key form". --> fixed
- [NIT] server.js compat/check all-off refusal uses DeepSeek's words. --> deliberate (2a review 7), unchanged

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

#### 6g/6j validation
- Mortals full suite at iteration 2's head (27506 tests, 1 fail): browser-checks-indexed, the new check had no README row. --> FIXED (README row, Origin BRANCH, synthetic). Then rebased on main 2eb410b251 (PigeonPete's #8090, no conflict) and re-run on Mortals: 27518 tests, 0 fail, entry clean for this exact hash. 6j call skipped on that clean entry; subdir audit passed.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html acctCompatShow | BRANCH | key kept across a vendor change, sent to the wrong vendor | FIXED | iteration 1 commit |
| 2 | 1 | WARNING | docs/browser-checks/render-glm-add-7206.js | BRANCH | check could not see #1 | FIXED | iteration 1 commit |
| 3 | 1 | WARNING | web/index.html add handler | BRANCH | Add left disabled after a vendor change mid-check | FIXED | iteration 1 commit |
| 4 | 2 | WARNING | web/index.html acctCompatShow | SELF | same-vendor re-pick re-armed Add mid-check | FIXED | iteration 2 commit |
| 5 | 6g | BLOCKER | docs/browser-checks/README.md | BRANCH | new check not indexed (browser-checks-indexed) | FIXED | 52671a4b05 |

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html paintKeyedProviderOptions typeof guard (iteration 1): left, it serves lifted-function tests.
- [NIT] server.js compat/check all-off words are DeepSeek's (iteration 2): deliberate since 2a.
- [NIT] comments at the compatAsk call sites and ACCT_KEYED_ROUTE / RUNNER still say DeepSeek alone (iteration 3): deferred, cosmetic, the code beside them covers both.
- [NIT] no assertion pins DeepSeek's setup row reading "Add in Settings" while its switch is on (iteration 3): deferred; the behaviour is visible in the check's output.
- [NIT] ACCT_COMPAT_WHICH stays set after acctShowSuccess hides the form (iteration 3): deferred; every exit path calls acctCompatShow(false) and stillHere() reads flow.hidden.

### Strengths (across all iterations)
- Each vendor is gated by its own switch at every page site, never by the "any" flag (iterations 1, 2, 3).
- The submit names the vendor taken at click time and re-checks its switch; the server refuses per vendor too (iteration 3).
- Removing pageReady leaves one condition, the vendor's marker, with a test that has controls in both directions (iterations 1, 2).
- Sweeps for missed 'deepseek' special cases found none (iterations 1, 2, 3).
