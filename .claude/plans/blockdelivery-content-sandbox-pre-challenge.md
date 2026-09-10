---
pre_challenge: true
method: challenge-loop
branch: blockdelivery-content-sandbox
diff_hash: 17894b1168f6546f74094ecbd54e8858f4fdfb778a10c3908d5e006f771e020a
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T15:59:16Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found zero new BLOCKER/WARNING/CONVENTION; witnessed by two models, opus + sonnet)
**Total findings:** 8 (0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 4 NITs, plus 1 harmless NIT)
**Fixed:** 5 | **Deferred:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty during this pass -- no loop fix had committed yet)
- [WARNING] tools/test-block-delivery.sh -- the fix set AGENT_WORKFORCE_HOME, but engine/store.js's dataRootFor resolves AGENT_WORKFORCE_DATA at HIGHER precedence (first branch), so an ambient AGENT_WORKFORCE_DATA (world switch / direnv / exported world) would make the HOME redirect inert and read the real you.json again -- the exact recurrence. --> FIXED: added `unset AGENT_WORKFORCE_DATA`, matching tools/test-data-root-1511.sh. PROVEN: 0 failures even with AGENT_WORKFORCE_DATA set to a real data root carrying a you.json.
- [CONVENTION] git commit subject -- the fix commit subject did not match the `<branch> -- <message>` / `#N: <message>` convention. --> FIXED: squashed the branch into one correctly-formatted commit.
- [NIT] the CONTROL matched STALE/delivered against the whole table, not the extracted row (the file's own convention). --> FIXED: extract the `you` row (`^  you `) before matching.

#### Iteration 2
**Reviewer model:** sonnet (rotated from opus per kosmos#2032)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [CONVENTION] .claude/plans/ filename lacks the `<branch>-<timestamp>.md` suffix the written convention prescribes. --> DEFERRED: pre-existing repo-wide drift (essentially every sibling plan file uses the short form, e.g. worldswitch-2238.md); my file matches the de-facto pattern and the challenge-loop's own plan-file lookup finds it. Renaming would make it the odd one out and would invalidate the proof hash for a cosmetic change.
- [NIT] the inline comment over-stated the parallel to test-data-root-1511.sh (which sandboxes a different, shell-side data root; only the unset idiom is shared). --> FIXED: softened the comment to cite only the shared unset idiom.
- [NIT] the CONTROL setup guard fell through on a save failure, producing two FAIL lines for one root cause. --> FIXED: `if ! save; then bad; else ... fi` short-circuits to one clean FAIL.
- 4 STRENGTHs: traced projects.js's separate seam and confirmed it reads via store.ROOT (covered); verified the fix on both starting conditions (unset and was-set); confirmed the harness gates release cuts (test:shell -> run-tests.sh -> release.sh step 3); noted the sandbox also closes a latent hazard where a bare test run could migrate the operator's real store.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [NIT] the comment lists "doctrine" among the content side, but engine/doctrine.js has no read() so it never has content (never a real-state leak vector). --> RECORDED, not fixed: harmless and not wrong -- the sandbox does cover doctrine's read path via store.ROOT (the checker calls `d.read ? d.read() : null`), so the comment accurately lists the content-side blocks the sandbox affects; it merely over-specifies which of them can leak. Re-opening the loop for a pedantic comment tweak is not warranted.
- 3 STRENGTHs: fix correct and complete on the Mac branch (all content-side reads forced to an empty root by construction); CONTROL valid and red-capable (save-then-read share one data root, row-scoped, short-circuit setup guard); sound shell-safety and conventions, plus the bonus operator-data-migration guard.
**Converged** -- no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-block-delivery.sh | BRANCH | AGENT_WORKFORCE_DATA outranks HOME; redirect could go inert | FIXED | eec1b850 (unset added, proven) |
| 2 | 1 | CONVENTION | (commit subject) | BRANCH | fix commit subject off-convention | FIXED | eec1b850 (squashed) |
| 3 | 1 | NIT | tools/test-block-delivery.sh | BRANCH | CONTROL matched whole table not row | FIXED | eec1b850 |
| 4 | 2 | CONVENTION | .claude/plans/ | BRANCH | plan filename lacks timestamp suffix | DEFERRED | de-facto repo pattern; matches siblings |
| 5 | 2 | NIT | tools/test-block-delivery.sh | BRANCH | over-stated the test-data-root-1511.sh parallel | FIXED | eec1b850 |
| 6 | 2 | NIT | tools/test-block-delivery.sh | BRANCH | setup guard fell through -> double FAIL | FIXED | eec1b850 |
| 7 | 3 | NIT | tools/test-block-delivery.sh | BRANCH | comment over-specifies doctrine as a leak vector | RECORDED | harmless; not fixed |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- CONTROL matched whole table (iter 1) --> FIXED
- over-stated test-data-root-1511.sh parallel (iter 2) --> FIXED
- setup-guard fall-through (iter 2) --> FIXED
- doctrine over-specified in the comment (iter 3) --> RECORDED, harmless

### Strengths (across all iterations)
- The fix targets the correct seam and is complete: unset AGENT_WORKFORCE_DATA + export an empty AGENT_WORKFORCE_HOME forces every content-side read (you/policy/doctrine/projects, all via store.ROOT) to an empty root by construction, on both starting conditions (iter 1, confirmed 2 and 3).
- The CONTROL arm is genuinely red-capable and correctly wired: real record saved and read through the same data root, row-scoped match, short-circuit setup guard -- it proves the STALE detection still discriminates, so a fix that greened against real you-state cannot let a genuinely-stale block ship (iter 2, confirmed 3).
- Sound shell-safety (set -u, mktemp+trap cleanup, quoting) and conventions; commit and (de-facto) plan filename correct (iter 3).
- Bonus: the AGENT_WORKFORCE_HOME redirect also prevents a bare `bash tools/test-block-delivery.sh` run from triggering maybeMigrateLegacyStore() against the operator's real store (iter 2/3).

### Verification note
Proven 0 failures on Agent1s AND on mortals (the box whose real you.json aborted every cut), and 0 failures even with AGENT_WORKFORCE_DATA set to a real data root carrying a you.json. Full validation suite: 5739/5739 pass, 0 fail (6j).
