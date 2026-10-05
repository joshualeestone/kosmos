---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0722
diff_hash: 85b59fa6564ba0b4bf18b6aa0605f7d0d482788a1954a0c50afd85f160e45921
validation: passed
subdir_audit: passed
timestamp: 2026-10-04T03:45:47Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 7 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs)
**Fixed:** 4 | **Deferred:** 0 | **Asked (awaiting user):** 0

Before this loop the lines had two ad-hoc reviews (not via this skill): a blind copy review (two overclaims fixed:
phone notifications must be on; only new agents are told) and Angel's cross-agent review (the crash-loop line is
Mac-only; the sign-in line keys on any margin). Both are recorded in .claude/plans/whatsnew-0722.md.

6.0 was not run separately: the Mortals validation queued before iteration 1 ran on the iteration-1 head (784964aea),
which is also the final head; the helper skipped on its clean entry (85b59fa6564b) at 6j.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] web/whats-new.json:10 - "An honest sign-in warning" is Mac-only and did not say so: engine/loginexpiry.js readCredDefault reads the macOS keychain (`security find-generic-password`) with no file fallback, so Windows never produces the warning --> FIXED (784964aea): the line begins "On a Mac"; the release entry says the same
- [NIT] web/whats-new.json:5 - "minutes after it starts" was looser than the 2-minute rule --> FIXED (784964aea): "soon after it starts"
- [NIT] web/whats-new.json:6 - "your phone is told" has no qualifier although a cooldown can drop it (the plan records why "once" was dropped)
- [NIT] web/whats-new.json:5,10,15 - three lines near the 140 cap
- [NIT] .claude/plans/whatsnew-0722.md:36-41 - stale sections --> FIXED (784964aea): marked superseded

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (1 duplicate), 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1
- [WARNING] web/whats-new.json:7 - the "Keeps stopping" line's Mac-only scope and phone condition, which the reviewer did not re-verify --> duplicate of resolved concerns: Windows supervisor writes no runs log (verified 21:53), phone notifications are off until turned on (verified 20:35)
- [NIT] web/whats-new.json:12 - "not that they have" reads a little short (the 140 cap)
- [NIT] .claude/plans/whatsnew-0722.md:1 - the top still shows the old ranking
**Converged** - no new actionable findings.

6j: Mortals full validation PASSED at 784964aea (hash 85b59fa6564b); the helper skipped on that clean entry; subdir audit passed.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/whats-new.json:10 | BRANCH | sign-in line Mac-only | FIXED | 784964aea |
| 2 | 1 | NIT | web/whats-new.json:5 | BRANCH | "soon after it starts" | FIXED | 784964aea |
| 3 | 1 | NIT | whatsnew-0722.md:36 | BRANCH | stale plan sections | FIXED | 784964aea |
| 4 | 2 | WARNING | web/whats-new.json:7 | BRANCH | crash-loop scope (duplicate) | FIXED | confirmed resolved |

### NITs (non-blocking, across all iterations)
- [NIT] web/whats-new.json:6 - phone told, no "once" (iteration 1)
- [NIT] web/whats-new.json:5,10,15 - lines near the cap (iteration 1)
- [NIT] web/whats-new.json:12 - "not that they have" wording (iteration 2)
- [NIT] .claude/plans/whatsnew-0722.md:1 - old ranking at the top (iteration 2)

### Strengths (across all iterations)
- [STRENGTH] Every line was checked against code on origin/main, and each platform claim was verified in both supervisors and both credential paths (iterations 1-2)
- [STRENGTH] tools/whats-new-check.js 0.7.22 passes: 5 highlights, icons valid, every line within 140 (iterations 1-2)
- [STRENGTH] The plan records each overclaim found and how it was fixed, including why #5146 dropped at the cap (iteration 1)
