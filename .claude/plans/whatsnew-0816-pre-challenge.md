---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0816
diff_hash: d08d0ab1e43b3143a3a6db17b7c243886f7e407b3a20d3e6de1be841093676cc
validation: passed
subdir_audit: passed
timestamp: 2026-11-22T23:10:13Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 6 (1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 4 NITs)
**Fixed:** 2 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation, fix-and-validate)
**Reviewer model:** none (validation helper)
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (6.0's synthetic finding is BRANCH by instruction)
- [BLOCKER] initial-validation: `tools.shell-shard-4317.test.js` #6791 review 2 failed: the #1720 coarse web gate refused a branch changing `web/whats-new.json` with no browser-check change and no `Browser-check:` trailer --> FIXED (commit 3cb6bd61d6, trailer as on the 0.8.15 What's New commits; the test passes alone, then full validation PASSED)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] release/whats-new-pool.json (restart-repeats line) — the line's "at least 3 times in a week" and "with the dates" could not be checked from the diff --> DEFERRED: verified true against 0.8.15 (f6ac36b940): `engine/restartnote.js` PATTERN_COUNT = 3 within PATTERN_MS = 7 days carrying the dates; the board's `rebootPattern` says "has restarted at least N times within a week while Kosmos was running (<dates>)". Recorded in the plan (commit a49d2762b1).
- [NIT] .claude/plans/whatsnew-0816.md — the list named four lines (two Windows lines shared a bullet) --> FIXED (commit a49d2762b1)
- [NIT] .claude/plans/whatsnew-0816.md — the plan does not say the pool title changed --> DEFERRED: it does ("retitled from 'The day count is off the K mark'"), and no other entry holds the old title

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [NIT] .claude/plans/whatsnew-0816.md:27 — "five What's New test files: 60/60" leaves out engine/whatsnew.test.js (12/12 there too)
- [NIT] .claude/plans/whatsnew-0816.md:10 — fd2715b8aa2c is not a commit; it is the served Windows 0.8.15 zip's sha256 (latest-win.json)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | initial-validation (#1720 web gate) | BRANCH | No Browser-check trailer on a web/ change | FIXED | 3cb6bd61d6 |
| 2 | 2 | WARNING | release/whats-new-pool.json (restart line) | BRANCH | Line's claims unchecked against shipped code | DEFERRED | Verified true at f6ac36b940 |
| 3 | 2 | NIT | .claude/plans/whatsnew-0816.md | BRANCH | List read as four lines | FIXED | a49d2762b1 |
| 4 | 2 | NIT | .claude/plans/whatsnew-0816.md | BRANCH | Rename not stated | DEFERRED | It is stated |

### NITs (non-blocking, across all iterations)
- [NIT] .claude/plans/whatsnew-0816.md — list read as four lines (iteration 2, fixed)
- [NIT] .claude/plans/whatsnew-0816.md — rename (iteration 2, already stated)
- [NIT] .claude/plans/whatsnew-0816.md:27 — test count omits engine/whatsnew.test.js (iteration 3)
- [NIT] .claude/plans/whatsnew-0816.md:10 — fd2715b8aa2c is the Windows zip sha256, not a commit (iteration 3)

### Strengths (across all iterations)
- An offline build of the committed pool is byte-identical to web/whats-new.json, and prod-check returns 0 (iterations 2, 3)
- The four Mac-visible 0.8.15 highlights are marked shown in 0.8.15 one for one, and the Windows-only line is retired by hand per the tool header (iterations 2, 3)
- None of the five titles was ever in an earlier window, so none shows twice; the K mark rename is safe (iteration 3)
- Windows 5, Mac 3, Linux 3: no platform empty (iterations 2, 3)
