---
pre_challenge: true
method: challenge-loop
branch: xsitechild-4309
diff_hash: 0b2dc4a4231d96f664718ff073ffa3b18c63d7ab1dc96b9a8a3e4d95fac21d6f
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T07:56:50Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (iteration 1 is 6.0's fix-and-validate pass; iterations 2 to 4 are blind reviews)
**Converged:** Yes
**Total findings:** 5 (1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 5 NITs)
**Fixed:** 4 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** none (validation helper)
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (6.0's synthetic finding is BRANCH by instruction)
- [BLOCKER] initial-validation: yarn test failed in the #4273 run-root leak guard, `aw-doorflight` not on the allowlist (10944 pass / 0 fail before the guard) --> FIXED (commit 9f1fbe531): server.doorflight-1618.test.js gets the same bin overrides and no-host-tool check; scope agreed with Johnny (m2239), confirmed by Liu Kang (m2289, m2291). Validation then passed at 4ff92fa64 with the guard clean.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above (the citation spans three files and line ranges, so it is recorded BRANCH)
- [CONVENTION] server.xsite-1636.test.js / server.connect.test.js / server.doorflight-1618.test.js — the recorder block and the final assertion were copied byte for byte into three files --> FIXED (commit 16a850de6): one helper, test-support/nohostcli.js; control re-run, all three files red without the helper's bin overrides.
- [NIT] the new test name is identical in all three files (triage shows only the name) — not changed; node --test reports the file.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above (both cite test-support/nohostcli.js lines written by 16a850de6; both are code, not prose, so fixed normally)
- [WARNING] test-support/nohostcli.js:25-27 — the wrapper dropped execFile's util.promisify.custom --> FIXED (commit d12dab6d1): wrapped so a promisified call keeps { stdout, stderr } AND is recorded. Measured: copying the symbol as-is kept the shape but left promisified calls unrecorded.
- [WARNING] test-support/nohostcli.js:33-35 — the footprint check blamed any home/Library or home/.npm on a host tool, though board code can write under HOME/Library --> FIXED (commit d12dab6d1): narrowed to Vercel's own folders; verified it still catches a real `vercel whoami` into a temp HOME.
- [NIT] the basename match misses gh.exe / vercel.cmd / shell launches — enough for devicedoor.js today; noted.
- [NIT] a host-independent negative-control arm would give the check teeth on CI — candidate follow-up, stated in the plan's weakest part.
- [NIT] server.connect.test.js:49 inline require('node:path') predates the branch — cosmetic, untouched.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.
- [NIT] CLAUDE.md's test-support row could name nohostcli.js — not changed.
- [NIT] the footprint check covers Vercel only, not gh — the start check covers both; noted.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | initial-validation | BRANCH | leak guard: aw-doorflight not on the allowlist | FIXED | 9f1fbe531 |
| 2 | 2 | CONVENTION | three test files | BRANCH | recorder and assertion copied into three files | FIXED | 16a850de6 |
| 3 | 3 | WARNING | test-support/nohostcli.js:25 | SELF | promisify.custom dropped | FIXED | d12dab6d1 |
| 4 | 3 | WARNING | test-support/nohostcli.js:33 | SELF | footprint check names the wrong cause | FIXED | d12dab6d1 |

### Final validation (6j)
- HEAD d12dab6d1: yarn type-check, lint-fix, test (11109 tests, 10945 pass, 0 fail, 164 skipped; leak guard clean, no family off the allowlist), build: PASSED, hash 0b2dc4a4231d. Subdir CLAUDE.md audit: passed.

### NITs (non-blocking, across all iterations)
- identical test name across three files (iteration 2)
- basename match misses .exe/.cmd and shell launches (iteration 3)
- no host-independent negative control on CI (iteration 3)
- pre-existing inline require in server.connect.test.js (iteration 3)
- CLAUDE.md test-support row does not name the helper (iteration 4)
- footprint covers Vercel only (iteration 4)

### Strengths (across all iterations)
- The fix removes the cause (the host CLI is never started) instead of waiting on a grandchild the board cannot hold (iterations 2, 3, 4).
- It reuses the documented binEnv override idiom already in engine/devicedoor.js and engine.dirmode-1763.test.js; no product code changes (iterations 2, 3).
- The require-order constraint is stated and followed in all three files (iterations 2, 3, 4).
- The plan records measured cause, both-arm before/after runs, the controls, the scope calls and its weakest part (iterations 3, 4).
