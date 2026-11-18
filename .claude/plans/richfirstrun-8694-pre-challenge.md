---
pre_challenge: true
method: challenge-loop
branch: richfirstrun-8694
diff_hash: e1c29250614fb90672abca28530c4453e2a25c24a16626c34b3c4e36a1fe4a53
validation: passed
subdir_audit: passed
timestamp: 2026-11-18T09:43:48Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 17 (0 BLOCKERs, 6 WARNINGs, 1 CONVENTION, 10 NITs)
**Fixed:** 6 WARNINGs and 4 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Baseline before iteration 1: the P11 rich block run in order on a sandboxed rich board booted the runner's way
(scratchpad harness): 9/9 with the change in full order, 7/7 in PR #8691's selection order; without the change, 7/7
in that order (since #8691 no check there depends on it). Full validation at convergence: 29,792 tests, 0 failed,
validation PASSED at hash e1c29250614f on head 103d75591f. Self-generated: not computed by a blame lookup in this run.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** unknown
- [WARNING] docs/browser-checks/render-detail-signedout-8662.js:34 - comment says the runner never completes first run --> FIXED (6f848454b3)
- [WARNING] tools/browser-checks.sh:1757 - a failed POST is silent --> FIXED (6f848454b3, curl -f and a FAILED entry)
- [WARNING] tools/browser-checks.sh:1757 - completing first run also seeds a project and arms the guide, unstated --> FIXED (6f848454b3, comment)
- [NIT] "render-list-row in a full run" names an unmeasured first closer --> FIXED (dropped)
- [NIT] the 403 and 401 checks' first-run comments are now historical

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** unknown
- [WARNING] tools/browser-checks.sh:1762 - does the CI allowlist treat a non-check FAILED label right --> FIXED by reading it: the allowlist acts at run_one, and non-check labels already fail the run the same way; separately test-browser-checks-workflow went red on the '||' form and the branch became an if (03ef6f411f; red, then green)
- [NIT] P18 also completes first run --> FIXED (03ef6f411f)
- [NIT] curl -f stricter than siblings (deliberate)
- [NIT] the 8662 comment is accurate

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** unknown
- [WARNING] tools/browser-checks.sh:1757 - the comment names the wrong guard (DRY_RUN, not a missing model) --> FIXED (103d75591f)
- [NIT] the P12 reason is what completing leaves behind, not first run being open --> FIXED (103d75591f)
- [NIT] no REASONS line for the new FAILED entry (the label explains itself)
- [NIT] no --max-time on the POST --> FIXED (103d75591f, 30 s)
- [NIT] the 403 and 401 comments are historical (as iteration 1)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** unknown
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | render-detail-signedout-8662.js:34 | BRANCH | stale "never completes" comment | FIXED | 6f848454b3 |
| 2 | 1 | WARNING | tools/browser-checks.sh:1757 | BRANCH | failed POST silent | FIXED | 6f848454b3 |
| 3 | 1 | WARNING | tools/browser-checks.sh:1757 | BRANCH | side effects of completing unstated | FIXED | 6f848454b3 |
| 4 | 2 | WARNING | tools/browser-checks.sh:1762 | BRANCH | non-check FAILED label and the allowlist | FIXED | read; 03ef6f411f |
| 5 | 3 | WARNING | tools/browser-checks.sh:1757 | BRANCH | wrong guard named | FIXED | 103d75591f |
| 6 | 2 | WARNING | tools/browser-checks.sh:1762 | BRANCH | '||' tripped the workflow invariant | FIXED | 03ef6f411f |

### NITs (non-blocking, across all iterations)
- [NIT] the 403 and 401 checks' first-run comments are now historical; their stubs are still right (iterations 1, 3, 4)
- [NIT] no REASONS line for the FAILED entry (iteration 3)
- [NIT] "would turn it red" kept strong: iteration 3 found adoptExisting can seed without a model (iteration 4)
- [NIT] the plan lists four boards, the comment five (iteration 4)

### Strengths (across all iterations)
- Placed at the P11 call site, not in boot_board_rich, so P12's click-first-run keeps a clean start (iterations 1-4)
- Matches the sibling boards' form and makes the checks' "first-run-complete board" headers true (iterations 1, 3)
- None of the nine P11 checks needs first run open or tests its screen (iterations 1, 3, 4)
