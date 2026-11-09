---
pre_challenge: true
method: challenge-loop
branch: win-version-8309
diff_hash: 6776e6a8db78cd57e510114c399ac40fb657d3cb1d84fafe4e7d3bddaaa73d0a
validation: substituted (the helper needs yarn/npm, absent on this Windows box; the repo's type-check is a no-op. Instead, with the no-schtasks preload, at e7509ccdc1: every test file that loads tools/windows/kosmos-cli (106 files) run one file at a time on the branch and on a control worktree at the merge base 69ffece4d4: identical pass/fail counts and identical failing test names in all 105 shared files (the failures are Mac-shell arms that fail the same on main on this box); the new tools.windows-kosmos-cli-version-8309.test.js 7/7; a negative control with origin/main's kosmos-cli.js fails all 7 new tests and the parity test; policy tests fixture-discipline, no-name-refs-3071, engine.reachable, engine/windows-tests-1777, engine/win32-separator-guard, engine/windows-coupling-audit-1732 67/67; worktree clean. Live: the new CLI in a scratch copy of the installed layout, through the real Git Bash launcher and kosmos.ps1, prints "0.8.00 (build e224150682)" for --version, -v and version, exit 0; "version extra" prints the usage, exit 2)
subdir_audit: passed
timestamp: 2026-11-09T17:46:41Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 raised no BLOCKER, WARNING or CONVENTION; its NITs are recorded below, and no code changed after the review, so the proof covers exactly the reviewed code).
**Total findings:** 5 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs)
**Fixed:** 0 | **Deferred:** 5 NITs (reasons below) | **Asked (awaiting user):** 0

Validation note: the canonical helper (validation_log_run_or_skip) cannot run on this box (no yarn/npm); substituted by the per-file branch-vs-control comparison above, as in the task-files-win-8227 and task-files-linkwalk-8232 proofs.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Converged** — no new actionable findings.
- [NIT] tools/windows/kosmos-cli.js:3622 — extra words get the usage and exit 2; the Mac's cmd_version ignores them --> DEFERRED: refusing is the Windows CLI's rule for every verb (each prints its usage on a malformed call), and printing a version for `version now` would hide a typo; the plan states it. A Mac change is out of this card's scope.
- [NIT] tools/windows/kosmos-cli.js:3609 — no twin of the Mac's #4892 "this is not the installed copy" stderr note --> DEFERRED: a Windows copy outside an install finds no files beside it and says "Kosmos looks incomplete here" (exit 1), so it never prints a wrong version, which was the harm #4892 addressed.
- [NIT] tools/windows/kosmos-cli.js:3610 — no source-tree fallback, so a checkout run says incomplete --> DEFERRED: matches the Mac (which also needs an install), and a checkout has no manifest.json, so it could never name a build.
- [NIT] tools/windows/kosmos-cli.js:3657 — the table entry is reached only through main()'s early return --> DEFERRED: main()'s early-return comment says why (before any token or request); the parity and new tests would go red if either were removed.
- [NIT] tools.windows-kosmos-cli-version-8309.test.js:62 — no test of the 7-char, uppercase or 6-char sha edges --> noted; the real manifest always carries a full 40-char lowercase sha (tools/build-kosmos-windows.sh writes git rev-parse HEAD).

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | NIT | tools/windows/kosmos-cli.js | extra words refused, Mac ignores | DEFERRED | Windows rule for every verb |
| 2 | 1 | NIT | tools/windows/kosmos-cli.js | no #4892 copy note | DEFERRED | a copy says incomplete, never a wrong version |
| 3 | 1 | NIT | tools/windows/kosmos-cli.js | no source-tree fallback | DEFERRED | matches the Mac |
| 4 | 1 | NIT | tools/windows/kosmos-cli.js | table entry only via early return | DEFERRED | commented, guarded by tests |
| 5 | 1 | NIT | test | sha length edges untested | DEFERRED | real manifests carry full shas |

### NITs (non-blocking, across all iterations)
- The five above (iteration 1).

### Strengths (across all iterations)
- Answered before the hook, any token or any request; the test proves it with hook, outbox and fetch that throw if touched (iteration 1).
- Every printed value is shape-checked; -dirty only on a JSON true, matching how the build script writes it (iteration 1).
- The help row is the Mac's sentence word for word, and the exit codes match (iteration 1).
- No regression across every file that loads the Windows CLI, checked against main by the reviewer as well (iteration 1).
