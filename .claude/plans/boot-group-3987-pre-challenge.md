---
pre_challenge: true
method: challenge-loop
branch: boot-group-3987
diff_hash: 1ac98bee3626f74bae6de8ea64b1f89d7d804c37e8a943e1e8b98bcdad27a3bc
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T16:29:31Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (plus one final-validation round that returned to 6e)
**Converged:** Yes
**Total findings:** 3 actionable (0 BLOCKERs from review, 1 synthetic BLOCKER from final validation, 2 WARNINGs, 0 CONVENTIONs), 11 NITs
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

Note on 6.0: the initial validation pass was not run before iteration 1, because a release (0.6.97)
held the machine and the validation sequence is the full suite (a heavy run). The first full
validation ran at 6j once `tools/heavy-gate.sh` read clear twice, found a real failure, and the loop
returned to 6e for it, so every committed state that reached the proof was validated.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] tools/browser-checks.sh:1220-1229 / card #3987 — the card's "both branches read it, so the name is written once" is not met: the booted branch's run_one calls still carry the names --> FIXED: card amended (the booted branch's run_one calls take different arguments, so a file cannot drive them; the test keeps the two in step); recorded in the plan's Decisions (b74c31f1c)
- [WARNING] tools.browser-checks-wired.test.js:348 — a $B8 check launched by a loop or a wrapper instead of a literal run_one would be invisible to the agreement check --> FIXED (b74c31f1c): every `node docs/browser-checks/<x>.js` in the block must have a literal `run_one "<x>"`, with a wrapper control
- [NIT] tools/browser-checks.sh:1228 — the missing-file entry said "named no checks" --> FIXED (b74c31f1c): "missing or named no checks"
- [NIT] tools.browser-checks-wired.test.js:356-359 — raw-line check stricter than the runner, intentional but unstated --> FIXED (b74c31f1c): comment added
- [NIT] tools.browser-checks-wired.test.js:343-353 — the empty-file guard was not tested --> FIXED (b74c31f1c): guard control added
- [NIT] tools.browser-checks-wired.test.js:137 — overlong rewrapped comment line --> FIXED (b74c31f1c)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Duplicates of prior findings (confirmed resolved):** 2 (the card criterion and the literal-run_one check, both confirmed by the reviewer's own three-way extraction)
**Converged** at 6d; proceeded to 6j.

#### 6j final validation (returned to 6e)
- [BLOCKER] final-validation: `tools/test-browser-checks-workflow.sh` failed: "a FAILED+=() entry in browser-checks.sh contains '|'". The empty-file guard was written `[ ... ] || FAILED+=(...)`, and that check is line-based --> FIXED (e7c051dd7): the guard is an `if`; the test's guard constant and its control follow; `tools/test-browser-checks-workflow.sh` exits 0

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
**Converged** — no new actionable findings. 6j re-ran the full sequence on e7c051dd7: validation PASSED (hash 1ac98bee3626), subdir audit passed.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | card #3987 / tools/browser-checks.sh:1220 | BRANCH | card criterion "written once" not met | FIXED | card amended; plan Decisions; b74c31f1c |
| 2 | 1 | WARNING | tools.browser-checks-wired.test.js:348 | BRANCH | non-literal run_one on $B8 invisible to the check | FIXED | b74c31f1c |
| 3 | 6j | BLOCKER | tools/browser-checks.sh (guard line) | BRANCH | '|' on a FAILED+=() line trips the FAILED-LIST check | FIXED | e7c051dd7 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] tools/browser-checks.sh:1228 — missing-file wording (iteration 1, fixed)
- [NIT] tools.browser-checks-wired.test.js:356 — strictness comment (iteration 1, fixed)
- [NIT] tools.browser-checks-wired.test.js:343 — guard untested (iteration 1, fixed)
- [NIT] tools.browser-checks-wired.test.js:137 — line width (iteration 1, fixed)
- [NIT] tools.browser-checks-wired.test.js:354 — the launch regex misses a quoted path, `./docs/...`, or a variable path (iteration 3, open; every line in the block uses the literal unquoted form today)
- [NIT] tools.browser-checks-wired.test.js:354-357 — assumes a run_one label equals its script name; a mismatch fails loudly with slightly wrong wording (iteration 3, open)
- [NIT] tools/browser-checks.sh:1221 — under the CI allowlist a failed boot reports all 30 names, including skipped ones; pre-existing behavior, 6 more names now (iteration 3, open)
- [NIT] .claude/plans/boot-group-3987.md — "Check" lists five controls; the test has seven (iteration 3, open)
- [NIT] docs/browser-checks/b8-board.txt:4 — "6 of the group's 30" will read as current once the group grows (iteration 3, open)

### Strengths (across all iterations)
- Measured the live drift before building (30 run, 24 named, the 6 missing listed) and fixed it, not only the conflict shape (iterations 1, 2, 3)
- Mirrors the gated.txt read loop exactly: array read before any node process can consume stdin, set -u safe on bash 3.2 (iterations 1, 3)
- Every control in the agreement test is aimed at a different arm of `b8Problems` and each was traced to red (iterations 1, 2, 3)
- A missing or empty file still records a failure, so a failed boot never reads as nothing failed (iterations 2, 3)
