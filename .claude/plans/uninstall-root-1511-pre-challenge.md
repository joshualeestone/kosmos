---
pre_challenge: true
method: challenge-loop
branch: uninstall-root-1511
diff_hash: 0d289f174aabbb7f857a8e8a6df12b3339519fc9e9ee4619c9d312d20fc4422b
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T02:54:11Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (two fresh, blind independent passes)
**Converged:** Yes — iteration 2 returned zero NEW BLOCKER/WARNING/CONVENTION findings after dedup, and no unresolved ASKED findings.
**Total findings:** 4 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 distinct NIT — raised independently by both passes)
**Fixed:** 1 (the NIT) | **Deferred:** 0 | **Asked (awaiting user):** 0

### Context for this run

This branch carried four prior committed challenge-loop iterations (`e52b86b7`..`f7ea815f`)
that found and fixed real defects (the capture-after-delete ordering bug, the
`sleep N; kill` watchdog leak, twelve refusal arms that could not tell a refusal from a
crash). This run is a fresh loop **after a rebase onto current `origin/main`** (the one
conflict was the `package.json` `test:shell` append, resolved by taking main's line and
appending `test-data-root-1511.sh` once). Two independent blind passes on the rebased code
both returned zero actionable findings and independently surfaced the same single NIT, so
convergence rests on five independent reviews in total, not one.

**Validation note:** the canonical `validation_log_run_or_skip` helper misdetects this
npm / plain-JavaScript repo as a pnpm/TypeScript stack and runs a nonexistent
`pnpm ... typecheck`, so it exits non-zero for a stack reason unrelated to this diff.
Validation was therefore done with the repo's actual pre-PR gates:
- `npm run test:shell` → rc=0 (runs `sh -n install/setup.sh` and `bash tools/test-data-root-1511.sh`; my package.json change extends this chain). Re-run as the 6j final gate on final HEAD: rc=0, 0 FAIL arms, my test ALL PASS (33 arms).
- full node+shell suite `bash tools/run-tests.sh` at baseline: 3609 node tests passed, 0 failed (`✖`=0), all shell sub-suites green. My diff touches zero JavaScript, so the node suite is orthogonal and a comment-only test change cannot affect it.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [NIT] tools/test-data-root-1511.sh:240 — arm 9h's `sleep 37` sub-assertion can never fail against the current `sleep 1` poll watchdog (live coverage is the ANDed `leftsh` check) --> FIXED (commit 133581fc)
- [NIT] install/setup.sh:1147 — system-Library inode refusal depends on `/Library/Application Support` existing to `stat` (macOS-guaranteed; a string-case fallback covers the default) --> DEFERRED: not a live gap on a macOS-only installer; the string-case arm covers the default and the inode arm covers symlink/case variants
- [NIT] install/setup.sh:1101-1109 — a `..`-bearing override is refused by the fallback but resolved by the consult (node `path.join` resolves `..`); same input, two outcomes by installed version --> DEFERRED: both branches are safe — the consult returns the correctly-resolved dir, the fallback refuses rather than guess; a conservative asymmetry, not a defect

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Duplicates of prior findings (confirmed):** 1 — independently re-raised the arm-9h `sleep 37` NIT from iteration 1, corroborating it.
- [NIT] tools/test-data-root-1511.sh:240 — (same as iteration 1) --> FIXED (commit 133581fc): arm 9h now states plainly that `left`/`sleep 37` is a LATENT regression guard against the old `sleep N; kill` pattern and cannot fail against current code, while `leftsh` is the live no-leak coverage — so a non-failing sub-assertion is no longer mistakable for current-behavior coverage.
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | tools/test-data-root-1511.sh:240 | arm 9h `sleep 37` sub-check cannot fail vs current watchdog | FIXED | 133581fc |
| 2 | 1 | NIT | install/setup.sh:1147 | system-Library inode refusal depends on `/Library/Application Support` existing | DEFERRED | macOS-guaranteed; string-case fallback covers default |
| 3 | 1 | NIT | install/setup.sh:1101-1109 | `..` override refused by fallback, resolved by consult | DEFERRED | both paths safe; conservative version-asymmetry |
| 4 | 2 | NIT | tools/test-data-root-1511.sh:240 | (dup of #1) | FIXED | 133581fc |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] tools/test-data-root-1511.sh:240 — vestigial `sleep 37` sub-assertion (iterations 1 & 2) — FIXED
- [NIT] install/setup.sh:1147 — inode refusal depends on system folder existing (iteration 1) — DEFERRED
- [NIT] install/setup.sh:1101-1109 — `..` override version-asymmetry (iteration 1) — DEFERRED

### Strengths (across all iterations)
- Single-capture-before-delete ordering is real and verified by content, not ancestry: `_support="$(_kosmos_data_root)"` sits inside `uninstall()` above the interpreter-removing `rm -rf "$KOSMOS_HOME"`; arm 11b runs the real uninstall in an `env -i` box and measures what was deleted, with a runtime-absent control reversing the outcome.
- Refuse-on-the-RESULT posture for a value that steers `rm -rf`; five reachable, enforced refusals; system-Library caught by both device:inode (following leaf and parent symlinks) and canonicalized string.
- Blast radius bounded by construction — no `rm -rf "$_support"`; every removal targets a named subpath, so even an attacker-influenced `AGENT_WORKFORCE_DATA` can only sweep Kosmos-named subfolders.
- The `grep -F` injection vector into `launchctl bootout`/`rm -f` is closed by refusing newline/quote/backtick/dollar/backslash before the value reaches the supervisor-ownership pattern.
- Arm 3 is a genuine discriminator on a platform where the product answer and the literal coincide; the watchdog was correctly rewritten from `sleep N; kill` to a self-terminating `kill -0` poll loop with its fds redirected off the command-substitution pipe.
- The deliberate non-routing of the sandbox guard is correctly reasoned and documented as load-bearing (comparing two same-derivation strings; routing one side would silently disable a refusal on a delete path).
