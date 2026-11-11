---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0803
diff_hash: 1072de53a86dccad6e3f6cba889e679639d2d71fa6945ed69a1ebed1c2f6414f
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-11T20:01:39Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 11 NITs
**Fixed:** 4 | **Deferred:** 0 | **Asked (awaiting user):** 0

**Validation, stated exactly.** The full suite ran once, at convergence, on Mortals: entry status clean, hash 1072de53a86d, 28474 tests, 27980 pass, 0 fail, 0 cancelled, all four shell shards complete. The change is data only. Each iteration that changed the data ran tools/whats-new-pool.js build and tools/whats-new-check.js for both platforms. The 6j helper skipped on the clean entry, rc 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json:1685 - the Gemini restore line was false for anyone upgrading with Gemini already set up (no record, so their uninstall keeps the values; the PR says so) --> FIXED (3981341c0c): reworded to "from this version on" and out of the window; the 0.8.01 restart note took the Mac slot
- [NIT] the Linux line could reach a later Mac or Windows window --> FIXED (3981341c0c): notesOnly
- [NIT] the Codex line unhedged --> carried into iteration 2

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json:1666 - the Codex changed-by line claimed every Codex agent on Windows; only a named Codex account gets the hook, on the measured codex-cli --> FIXED (8cd3c72130): its real reach, and out of the window (notesOnly)
- [NIT] the browser line named every browser; it covers the sign-in openers --> FIXED (8cd3c72130)
- [NIT] the reporting note is reasoned, not measured; the Linux note shows on Mac and Windows notes --> left, both stated in the plan

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the Gemini line rewritten in iteration 1)
- [WARNING] release/whats-new-pool.json:1688 - the Gemini line was kept out of this window by rank alone, and its reason never expires, so a later window would show it --> FIXED (6094e7ab14): notesOnly
- [NIT] the Codex note's undo copy needs undo on --> FIXED (6094e7ab14)
- [NIT] the plan's iPhone row and one sentence --> FIXED (6094e7ab14)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [NIT] the Gemini note is mac-tagged though Linux has it too (stated in the plan)
- [NIT] the Codex note's "own Codex account" is accurate
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json:1685 | BRANCH | Gemini restore false for upgraders | FIXED | 3981341c0c |
| 2 | 2 | WARNING | release/whats-new-pool.json:1666 | BRANCH | Codex line overclaimed | FIXED | 8cd3c72130 |
| 3 | 3 | WARNING | release/whats-new-pool.json:1688 | SELF | Gemini line reaches a later window | FIXED | 6094e7ab14 |

(A fourth WARNING-class correction, the plan's window count, was mine at 88e4bfee9d, found while reading the build output.)

### NITs (non-blocking, across all iterations)
- 11 in all; 6 taken, the rest stated in the plan or accurate as written.

### Strengths (across all iterations)
- build 0.8.03 --offline reproduces web/whats-new.json byte for byte (every iteration).
- The five items marked shown are exactly 0.8.02's window at its pin 91feaa2e15 (iterations 1, 3, 4).
- Every merged desktop PR since that pin has a line or a stated reason for none (every iteration).
