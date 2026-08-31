---
pre_challenge: true
method: challenge-loop
branch: fix-1594-pin-pw-runtime
diff_hash: 9b167db1e4e56035cd80b6617f7d96bae8088c63f723255ab44d857295a1828c
validation: passed
subdir_audit: passed
timestamp: 2026-08-31T14:15:46Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 surfaced zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 7 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs)
**Fixed:** 5 | **Deferred:** 2 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] tools/provision-pw.sh — `npm i playwright@X` without --save-exact records a caret RANGE in pw-runtime's package.json, so a later bare npm i could drift the build --> FIXED (added --save-exact, iter1 commit)
- [NIT] tools/provision-pw.sh — `npx --yes playwright install` could fetch an unpinned playwright if local resolution failed --> FIXED (use local ./node_modules/.bin/playwright, iter1 commit)
- [NIT] tools/provision-pw.sh — installed_version's `cat|sed|head` exposes a SIGPIPE under set -euo pipefail --> FIXED (guarded direct sed, iter1 commit)

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] tools/browser-checks.sh resolve_pw + provision-pw.sh — the KOSMOS_PW_RUNTIME_DIR override half-composed: provision honoured it but resolve_pw hardcoded ~/work/pw-runtime; and the ready message misled for a relocated dir --> FIXED (resolve_pw honours the override; message accurate for a relocated dir, iter2 commit)
- [NIT] tools/provision-pw.sh installed_version — could go multiline if a second "version" field ever matched --> FIXED (sed quits at the first match; no head pipe, iter2 commit)
- [NIT] tools/browser-checks.sh:226 — a pre-existing illustrative "1.62.1" in a comment --> DEFERRED (not in my diff; an illustrative measurement note, not a live pin; out of scope)
- [NIT] tools/provision-pw.sh — the browser-install runs unconditionally even on the no-op path --> DEFERRED (intentional: it completes a half-provisioned dir; playwright no-ops when builds exist)

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both duplicate/confirming deferred items)
**Converged** — the two NITs were the deferred unconditional-install note again and a defensive note on installed_version confirming its heuristic is safe (not reachable, documented). No new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | provision-pw.sh | npm i not --save-exact (range recorded) | FIXED | iter1 commit |
| 2 | 1 | NIT | provision-pw.sh | npx --yes could fetch unpinned | FIXED | iter1 commit |
| 3 | 1 | NIT | provision-pw.sh | installed_version SIGPIPE under pipefail | FIXED | iter1 commit |
| 4 | 2 | WARNING | browser-checks.sh:172 | KOSMOS_PW_RUNTIME_DIR override half-composed | FIXED | iter2 commit |
| 5 | 2 | NIT | browser-checks.sh:226 | pre-existing illustrative version in a comment | DEFERRED | not my diff; not a live pin |
| 6 | 2 | NIT | provision-pw.sh | installed_version could go multiline | FIXED | iter2 commit |
| 7 | 2 | NIT | provision-pw.sh | browser-install unconditional on no-op path | DEFERRED | intentional; completes a half-provisioned dir |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- provision-pw.sh: the "no-op" message slightly overstates (the browser-ensure still runs) -- kept deliberately (heals a missing browser build).
- provision-pw.sh installed_version: the first-match heuristic is safe for playwright's real manifest and documented.

### Strengths (across all iterations)
- resolve_pw stdout purity preserved: its stdout is the captured resolved path, and both new loud npx-cache warnings are redirected `>&2`, so the path is never corrupted. (iterations 1, 2, 3)
- The pin is a genuine single source of truth: PW_VERSION lives only in provision-pw.sh, --save-exact makes the on-disk record match, both engines install via the local pinned binary (not npx --yes), and the test enforces no second copy of the version in the gate. (iterations 2, 3)
- The test is well-shaped: purely static (no install/network), exact-version negative control, both engines, the throwaway provision is gone, the npx-cache branch is loud, and it is wired into test:shell with a syntax check. (iterations 1, 2, 3)
- KOSMOS_PW_RUNTIME_DIR is now honoured symmetrically in the provisioner and resolve_pw, so a relocated runtime is actually found. (iteration 3)

### Note on validation
One full-suite run during the loop showed a single red on `server.test.js:5575` ("the first-run routes answer", `read ECONNRESET`) -- a machine-contention flake unrelated to this shell-only diff, confirmed green in isolation and re-run green (final validation hash 9b167db1e4e5, fail 0). Per the repo's #708 guidance (green alone = contention). The recorded validation above is the clean run.
