---
pre_challenge: true
method: challenge-loop
branch: wn-0760
diff_hash: bddccc4435a3b89a2636f544ad911303aa247b31b05e46fa89a4f3ed6e8cc7f9
validation: passed
subdir_audit: passed
timestamp: 2026-10-19T16:33:22Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes, at iteration 2 (one NIT, left with its reason)
**Total findings:** 1 BLOCKER, 2 WARNINGs (all fixed or held as an ordering condition), 2 NITs
**Fixed:** 1 BLOCKER, 1 WARNING | **Ordering condition:** 1 | **Deferred:** 2 NITs | **Asked (awaiting user):** 0

Reviewer models alternate: odd iterations opus, even iterations sonnet (kosmos#2032).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [BLOCKER] release/whats-new-pool.json - "switching back skips the sign-in page" is Mac only (native-app/main.swift switchGoesHome; tools/windows/KosmosLauncher.cs has no such rule) but the item showed on both platforms --> FIXED (platforms mac; the line says "back to this Mac")
- [WARNING] "opens it right away" / "is instant" overclaimed (an older Kosmos on the other computer does not open; the K screen only covers the wait) --> FIXED (title "Smoother computer switching"; the line claims no instant switch)
- [WARNING] PR #6603 not yet merged --> ORDERING CONDITION (this PR merges, and 0.7.60 freezes, only once #6603's merge commit is on main)
- [NIT] browsers get neither behaviour --> no action (What's New shows in the app windows)
- Verified: built file byte-identical to the tool's output; whats-new-check 0.7.60 passes and a control (0.7.59) fails.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- Verified against #6603's diff: the K plus "Opening <name>" shows from the click until the other page replaces this one; in the Mac app a navigation to this computer's own Kosmos+ address goes home without a sign-in page; "mac" is the pool's platform format; byte-identical build; check passes (mac 5, windows 3).
- [NIT] "until it opens" is not exact for an older Kosmos (no K; a toast says to update) --> DEFERRED (rare, and the suggested "while it opens" is no more exact)
**Converged** - no actionable findings.

### Tests
whats-new-check.js 0.7.60: pass (mac 5, windows 3). Browser check render-whatsnew-title-6299: PASS at a79a65f93c. Full validation on Mortals: passed.
