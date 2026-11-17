---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0807
diff_hash: 025d6dd3b1edef041f244d35b5655688388cde26ca06f9301d5395db3918869d
validation: passed
subdir_audit: passed
timestamp: 2026-11-17T02:11:26Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes. Iteration 6 raised nothing new: one WARNING repeated iteration 3's deferral, and the other asked for a re-read of latest-win.json, done at 19:46 CST (0.8.06, 32f15fd1).
**Total findings:** 1 BLOCKER, 10 WARNINGs, 0 CONVENTIONs actionable after dedup, plus NITs
**Fixed:** 10 | **Deferred:** 1 | **Asked (awaiting user):** 0

Validation: full suite passed on the final data (validation-log PASSED, hash 025d6dd3b1ed): node part 0 fail, shell tests, build. tools/whats-new-check.js 0.8.07: 5 highlights (mac 5, windows 4). Both browser-check gates pass (the Browser-check trailer on every data commit).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] release/whats-new-pool.json: the #6249 line named the wrong case --> FIXED (2af76a51d8, rewritten, out of the window)
- [WARNING] #6249 untagged though Mac/Linux-only --> FIXED (2af76a51d8, mac)
- [WARNING] #8597 untagged though Mac/Linux-only --> FIXED (2af76a51d8, mac)
- [WARNING] community line suggested deleting was new and dropped conditions --> FIXED (2af76a51d8)
- [NIT] #8601 tag, Codex scope, repeat title --> FIXED; plan review log --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2 of the above (lines written in iteration 1)
- [WARNING] repeat line stronger than the code (idle gate) --> FIXED (18f1b5cf4a, 9553990b4b)
- [WARNING] community line missing the linked-agent condition --> FIXED (18f1b5cf4a)
- [NIT] Windows startup-job title --> FIXED (9553990b4b; the first try was 54 characters, refused by build, caught and shortened)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] two Windows-only 0.8.03 items may have been shown on Windows prod --> DEFERRED: outside this window, so 0.8.07 is unchanged; check before the build that brings them in
- [NIT] community line "its" vs "their" --> FIXED (53bc457aca)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] community line: the link needs posts on the site (onSite > 0) --> FIXED (0eefbb59f7)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] community line: no Kosmos+ sign-in --> FIXED (4584552c57)
- [WARNING] community line: posted is wider than linked --> FIXED (4584552c57); the wording DECIDED in the plan after five rounds each narrowed it
- [NIT] typed-line "holds only it" --> FIXED (4584552c57)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs (2 duplicates/verification), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** -- the hand retirement re-verified (latest-win.json 0.8.06 at 19:46 CST); the 0.8.03 items are iteration 3's deferral.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | release/whats-new-pool.json (#6249) | BRANCH | wrong case described | FIXED | 2af76a51d8 |
| 2 | 1 | WARNING | release/whats-new-pool.json (#6249) | BRANCH | missing mac tag | FIXED | 2af76a51d8 |
| 3 | 1 | WARNING | release/whats-new-pool.json (#8597) | BRANCH | missing mac tag | FIXED | 2af76a51d8 |
| 4 | 1 | WARNING | release/whats-new-pool.json (#7215) | BRANCH | community line overclaims | FIXED | 2af76a51d8 |
| 5 | 2 | WARNING | release/whats-new-pool.json (#8581) | SELF | idle gate missing | FIXED | 18f1b5cf4a |
| 6 | 2 | WARNING | release/whats-new-pool.json (#7215) | SELF | linked-agent condition | FIXED | 18f1b5cf4a |
| 7 | 3 | WARNING | release/whats-new-pool.json (Windows 0.8.03) | BRANCH | possibly shown on Windows prod | DEFERRED | outside this window |
| 8 | 4 | WARNING | release/whats-new-pool.json (#7215) | SELF | posts-on-site condition | FIXED | 0eefbb59f7 |
| 9 | 5 | WARNING | release/whats-new-pool.json (#7215) | SELF | sign-in missing | FIXED | 4584552c57 |
| 10 | 5 | WARNING | release/whats-new-pool.json (#7215) | SELF | posted wider than linked | FIXED | 4584552c57 (decided) |
| 11 | 6 | WARNING | release/whats-new-pool.json (retirement) | BRANCH | re-read latest-win.json | FIXED | re-read 19:46 CST |

### NITs (non-blocking, across all iterations)
- [NIT] new entries list since/status before title (iterations 3 to 6; no behaviour)
- [NIT] mac tags keep two Mac/Linux fixes out of Linux notes (iterations 3, 5; the pool's existing rule)
- [NIT] the typed-line line does not say the retries are bounded (iterations 2, 6; out of the window)

### Strengths (across all iterations)
- The built file is exactly the pool's top five, recomputed independently twice (iterations 3, 5, 6)
- The merge list matches git log --first-parent f7fb719e9e..origin/main with nothing missed (every iteration)
- The shown retirements follow the pool's rules (iterations 1, 3, 4, 6)
