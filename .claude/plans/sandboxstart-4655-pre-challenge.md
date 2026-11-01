---
pre_challenge: true
method: challenge-loop
branch: sandboxstart-4655
diff_hash: 2597c9620c0cffe6c379eba79ba3a57c6485ae66fab25bf4fd4a712d2ee678e2
validation: failed (13 load timeouts in the full run; all 9 files pass alone, 279 of 279; shell stage not reached)
subdir_audit: passed
timestamp: 2026-11-01T09:24:26Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation at 416faf6d0f: node had 13 failures, nearly all CLI tests timing out at 20 s or more, in 9 files. Run alone on the same head right after, those 9 files pass 279 of 279. They are read as contention on a shared box, which the suite's own banner names, not as this change. Node's red stopped the run before the shell stage, so the shell shards did not run here; CI runs them on this head. cli.sandbox-4636.test.js passes 34, 1 skipped.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] install/kosmos:909 — a missing /bin/ps read as a sandbox, so Linux with no ps refused every start --> FIXED (416faf6d0f): _start_is_sandboxed
- [WARNING] install/kosmos:1874 — a refused start left the person's start mark --> FIXED (416faf6d0f)
- [WARNING] plan — the claim about an MDM account and a fresh install was false --> FIXED (416faf6d0f): the plan states the install stop
- [NIT] words for Linux --> moot after the Mac gate
- [NIT] the real CLI's restart refusal had no test --> FIXED (416faf6d0f)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [NIT] the plan's board-run perturbation is not shown by a passing run (it was run by hand, in a scratch copy: the arm fails)
- [NIT] a hand-typed board-run on a Mac with ps failing twice is refused, as the plan names
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | install/kosmos:909 | BRANCH | Missing ps read as a sandbox | FIXED | 416faf6d0f |
| 2 | 1 | WARNING | install/kosmos:1874 | BRANCH | Person's start mark left | FIXED | 416faf6d0f |
| 3 | 1 | WARNING | plan:17 | BRANCH | False claim about fresh installs | FIXED | 416faf6d0f |

### NITs (non-blocking, across all iterations)
See each iteration above.

### Strengths (across all iterations)
- A live board in the sandbox is untouched by start, board-run and restart (iteration 1)
- Definitions load before use, and the set -e paths are safe (iteration 2)
