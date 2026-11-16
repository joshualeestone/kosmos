---
pre_challenge: true
method: challenge-loop
branch: cutleftover2-8563
diff_hash: 47c3e2296669e54c64abdcbeeafaa58a8f54bbdbeb74a8572a09fdf7ecb2be50
validation: passed
subdir_audit: passed
timestamp: 2026-11-16T01:41:52Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (iteration 1 is 6.0's fix-and-validate pass; blind reviews at iterations 2 and 3)
**Converged:** Yes
**Total findings:** 11 (1 BLOCKER, 1 WARNING, 4 CONVENTIONs, 5 NITs; 2 NITs fixed, 3 left with reasons)
**Fixed:** 8 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** none (validation helper)
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (6.0's synthetic finding is BRANCH by instruction)
- [BLOCKER] initial-validation: shell.pipefail-ratchet-8195.test.js failed: the new cases 22 and 23 piped printf into grep -q, an early reader under pipefail --> FIXED (c0b01508b7: a has() substring helper with no pipe; the new cases still red on main's library; the ratchet 3/3)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 4 CONVENTIONs, 2 NITs
**Self-generated:** 7 of the above (all cite lines written by this branch's own commits; each fix narrowed or corrected a claim to match the code, none added a new unguarded one)
- [WARNING] tools/lib/release-leftovers.sh:130 - the "cut again once the host answers" way-on also fired for a committed Linux manifest with no leftover file, where cutting again only reaches the manifest refusal --> FIXED (7cb3839be7: the way-on names what is left to do: files to move, the Linux manifest commit to revert, or waiting for the host; new test case 22b pins the Linux case)
- [CONVENTION] tools/lib/release-leftovers.sh:1-19 - the header did not name the committed Mac manifest trigger --> FIXED (7cb3839be7)
- [CONVENTION] tools/lib/release-leftovers.sh:24-27 - the guard's usage entry read garbled after the stage note --> FIXED (7cb3839be7: description first, the stage note after)
- [CONVENTION] tools/release.sh:1901 - "reads nothing when no leftover is here" was no longer true --> FIXED (7cb3839be7: "when nothing of $V is here")
- [CONVENTION] docs/releasing.md:449-458 - the runbook did not name the new trigger --> FIXED (7cb3839be7)
- [NIT] tools/lib/release-leftovers.sh:119 - "do not move these files" when no files were listed --> FIXED (7cb3839be7: said only when files were found)
- [NIT] tools/test-release-leftovers-8562.sh:229 - case 22's served arm did not prove the host was read --> FIXED (7cb3839be7: asserts the .sha256 URL was read and the files clause is absent)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 actionable
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | shell.pipefail-ratchet-8195.test.js | BRANCH | early grep -q readers under pipefail in new cases | FIXED | c0b01508b7 |
| 2 | 2 | WARNING | tools/lib/release-leftovers.sh:130 | SELF | way-on wrong for a committed Linux manifest | FIXED | 7cb3839be7 |
| 3 | 2 | CONVENTION | tools/lib/release-leftovers.sh:1 | SELF | header missing the Mac manifest trigger | FIXED | 7cb3839be7 |
| 4 | 2 | CONVENTION | tools/lib/release-leftovers.sh:24 | SELF | guard usage entry garbled | FIXED | 7cb3839be7 |
| 5 | 2 | CONVENTION | tools/release.sh:1901 | SELF | comment no longer true | FIXED | 7cb3839be7 |
| 6 | 2 | CONVENTION | docs/releasing.md:449 | SELF | runbook missing the trigger | FIXED | 7cb3839be7 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] tools/lib/release-leftovers.sh:119 - files clause with no files (iteration 2; fixed in 7cb3839be7)
- [NIT] tools/test-release-leftovers-8562.sh:229 - case 22 served arm did not prove the host read (iteration 2; fixed in 7cb3839be7)
- [NIT] tools/lib/release-leftovers.sh:30 - one long header line (iteration 3; left: a comment's wrap)
- [NIT] tools/lib/release-leftovers.sh:141 - `[ ... ] && move+=(...)` as the loop's last statement; safe today, an if block would be clearer (iteration 3; left: correct as written, errexit does not fire on a failed && left side)
- [NIT] tools/test-setup-staging-5032.sh:59 - the arm now prints one PASS fewer (iteration 3; left: intended, the reviewer found nothing that counts PASS lines)

### Strengths (across all iterations)
- A re-cut of a served version now refuses at 1g, before any build, with tests for served, never served and host down (iterations 2 and 3).
- The stage argument defaults to 8, so existing callers behave as before; both call sites and the grep pins changed together (iteration 3).
- New behaviour checks were run against main's library and fail there, so they can catch a regression (iterations 1 and 2).
