---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0795
diff_hash: d6bf5e6312216389701d149fda43aad00a2909849ca792c110b8a5948a6c04c4
validation: passed (Mortals full suite, 27626 tests, 0 fail, entry clean for this hash, base 6c7bcc855b)
subdir_audit: passed
timestamp: 2026-11-06T22:02:32Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 raised NITs only)
**Total findings:** 2 actionable (1 BLOCKER, 1 WARNING, 0 CONVENTIONs), 4 NITs
**Fixed:** 2 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] release/whats-new-pool.json #5167 line: "says why instead of nothing happening" was false; the Mac app already alerted on that failure (since 0744051ff8), and the change only adds the system's reason when there is one. --> FIXED: retitled "A failed download gives the system's reason", the line says exactly that, ranked 20 (below the window).
- [WARNING] the Mac-only #5167 item took the fifth slot ahead of a Windows security notice, leaving Windows no line of its own. --> FIXED: #8111 ranked 9.5 and takes the fifth slot.
- [NIT] "A shared run folder is named" read as if the folder is named --> FIXED: "Kosmos says when others can change its folder".
- [NIT] "its dots" in the orb line --> FIXED: "the orb's dots".
- [NIT] community status lists posts and comments --> FIXED: the title and line say so.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [NIT] "Opening" could read as opening any screen --> left: true for the ordinary case (the switch screen and the boot cover).
- [NIT] the plan file needs nothing --> noted.
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | release/whats-new-pool.json #5167 | BRANCH | claimed a new alert that already existed | FIXED | iteration 1 commit |
| 2 | 1 | WARNING | release/whats-new-pool.json ranks | BRANCH | Windows had no line of its own | FIXED | iteration 1 commit |

### NITs (non-blocking, across all iterations)
- "Opening" in the orb line (iteration 2): left.

### Strengths (across all iterations)
- The built web/whats-new.json is byte-identical to the tool's output (both iterations).
- notesOnly only on the two agent commands; platform tags right (mac, windows); every since is 0.7.95.
- No em dash in any of five spellings; lengths within limits; unique titles.
