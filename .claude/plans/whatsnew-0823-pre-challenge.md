---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0823
diff_hash: 1d8805ad33404c48fca37f26277ca3ff6a20fade5742864fe79142671a765f55
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-25T10:54:09Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 WARNING, 0 BLOCKERs, 1 CONVENTION (the plan file present), 7 NITs
**Fixed:** 1 WARNING and 4 NITs | **Deferred:** 0 | **Asked:** 0

Validation: full suite on Mortals via mortals-validate.sh, entry `"status":"clean"`, hash 1d8805ad3340 (equal to this
proof's diff_hash), 31,174 tests, 0 failed, at head 03d4f6dc86, 04:26 to 04:53 CST. The 8 test files that read the
What's New files: 534 pass, 0 fail. The subdir CLAUDE.md audit passed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json - the safety-prompt item was tagged mac for a wrong reason: its plan-file approval is engine code Windows runs too --> FIXED: split into an untagged plan-file line and a mac-tagged no-buzz line (03d4f6dc86)
- [NIT] plan: Linux shows only untagged highlights, not the Mac list --> FIXED
- [NIT] plan: the phone's size header is in the TestFlight build --> FIXED (reason restated)
- [NIT] the file line read wider than the code (zip-based files only) --> FIXED ("an Office or zip file")
- [NIT] the restart line covered exits the code does not mark --> FIXED ("stops on its own")

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] "a safety check left to you" could say "one that expires on its own"
- [NIT] the handoff line states the normal case unconditionally (the plan records the skips)
- [NIT] the plan's Linux line is right; no copy impact

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json | BRANCH | safety item tagged mac for a wrong reason | FIXED | 03d4f6dc86 |

### NITs (non-blocking)
- "left to you" wording (iteration 2)
- the handoff line stated unconditionally (iteration 2)

### Strengths
- Every line was checked against the merged code on main, and each platform tag against the code that runs there (both rounds)
- Pool bookkeeping: lastProd and lastProdWin are 0.8.22, and 0.8.22's highlights are marked shown (both rounds)
- Every change merged since the 0.8.22 bump is accounted for, each one left out with its reason (both rounds)
