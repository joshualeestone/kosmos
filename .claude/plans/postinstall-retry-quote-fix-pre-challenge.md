---
pre_challenge: true
method: challenge-loop
branch: postinstall-retry-quote-fix
diff_hash: f9ce87e6daf5906099f6b0903a928827522fcf0ad4dbec01bbb5edc2ec931ed1
validation: passed
subdir_audit: passed
timestamp: 2026-09-18T14:16:00Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 produced zero new actionable findings)
**Total findings:** 6 actionable (0 BLOCKERs, 5 WARNINGs, 1 CONVENTION) + assorted NITs
**Fixed:** 6 | **Deferred:** 0 | **Asked (awaiting user):** 0

The P0 fix itself (`''` -> `""` at postinstall:217-218) was correct and complete on
entry; three independent reviewers hand-reproduced the mechanism and confirmed no
other install-time inline `/bin/sh -c '...'` block carries the bug class. Every
actionable finding was in the new guard test or the fix's own explanatory comment,
and each was a genuine hardening of the regression guard.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first blind pass; 6.0 passed clean)
- [WARNING] tools/test-postinstall-inline-quoting.sh — extractor triggered ONLY on the backslash `/bin/sh -c \` form, so inline block 1 (same-line `-c '` open at postinstall:111) was silently uncovered while the docstring claimed "each inline block" --> FIXED (511b36c22): trigger both open forms; add an independent `opens` count oracle (`n -eq opens`) so a dropped block is a false-pass no more; `set -f` the glob-unsafe split loop. Red-capable proven (injected `''` in block 1 now fails).
- [CONVENTION] .claude/plans/ — no plan file for this branch --> initially deferred, later FIXED (see iteration 6).
- [NIT] unquoted `for blk in $blocks` with glob-metachar bodies --> folded into 511b36c22 (`set -f`).
- [NIT] brittle close-detection --> noted; later commented (7f533fbb3) and hardened (1e5a3c5bd).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (the cited postinstall:206 was added by the branch's P0 fix commit 601ef2bd6, not a loop commit)
**Duplicates of prior findings:** 1 (plan file)
- [WARNING] install/pkg-scripts/postinstall:206 — the fix comment introduced the block's first NON-adjacent interior single-quote pair (`'...'`); `tr -d "'"` is faithful only because that gap is metachar/whitespace-free today --> FIXED (7f533fbb3): reword to drop the `'...'` so every interior quote is an adjacent zero-gap pair. Verified inert (even parity, comment-only, no unquoted whitespace -> no installer regression).
- [NIT] temp-file leak on signal --> FIXED (7f533fbb3): EXIT/INT/TERM trap.
- [NIT] close-pattern assumption undocumented --> commented (7f533fbb3).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (close-detection logic predates the loop; BRANCH)
**Duplicates of prior findings:** 1 (plan file)
- [WARNING] tools/test-postinstall-inline-quoting.sh — false-EARLY-close: `n -eq opens` catches a block that never closes, but not one that closes too early, so a future body line matching the close heuristic would truncate a block before the guarded `case` lines while `n` still equals `opens` -> silent false-pass --> FIXED (1e5a3c5bd): positive coverage anchor asserting the two guarded `case` lines were inside a reconstructed+checked block. Red-capable proven (injected early-close now fails loud).
- [NIT] `/tmp/pi-inner-err.$$` -> mktemp --> FIXED (1e5a3c5bd).

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** the shape-scope finding concerns the trigger regex added in 511b36c22 (SELF), resolved by documentation rather than deletion (not a prose-claim deletion case)
**Duplicates of prior findings:** 1 (plan file)
- [WARNING] tools/test-postinstall-inline-quoting.sh — shape-scope: the `opens` oracle and the awk extractor share one trigger regex, so a differently-shaped FUTURE inline invocation would escape both identically without tripping `n -eq opens`. Not a current defect (`opens == n == 2`) --> FIXED (3e5211e59, doc): document the covered/uncovered shapes and instruct a maintainer to extend the regex + docstring if a new shape is added. (A reconcile-against-total-occurrences check was rejected: it would false-fail on prose mentions of `/bin/sh -c`.)
- [NIT] in-block comment apostrophes fragile --> escalated in iteration 5.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs
**Self-generated:** partial (I reworded postinstall:206 in 7f533fbb3; the finding concerns the 205-211 comment block added by the branch's P0 commit 601ef2bd6) — resolved by removing content, not by rewriting a claim, so no kosmos#120 comment-thrash
**Duplicates of prior findings:** 1 (plan file)
- [WARNING] install/pkg-scripts/postinstall:205 — the explanatory comment sits INSIDE the single-quoted `-c` block and its apostrophes are load-bearing on the block's outer quote parity; a future edit adding a lone apostrophe would silently re-break the install in the exact P0 class --> FIXED (92970d3e9): reword to ZERO interior single quotes (block-2 body now has none), keep the warning at the fix site, add an explicit "keep this block apostrophe-free" instruction. Verified inert; file-level `sh -n` and the guard both green.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 actionable (only the plan-file CONVENTION, a duplicate of the ledger's outstanding entry)
**Self-generated:** 0
**Duplicates of prior findings:** 1 (plan file)
**Converged** — two STRENGTHs confirming the fix is correct/complete and the guard is red-capable and non-vacuous (both verified by hand-reproduction in scratch). The only outstanding item, the plan-file CONVENTION, was then resolved by creating the plan file (5d4fed20a) per the repo CLAUDE.md convention (siblings all carry one) rather than deferring it.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | No plan file for branch | FIXED | plan file (5d4fed20a) |
| 2 | 1 | WARNING | tools/test-postinstall-inline-quoting.sh | BRANCH | Extractor covered only 1 of 2 inline blocks; docstring claimed both | FIXED | 511b36c22 |
| 3 | 2 | WARNING | install/pkg-scripts/postinstall:206 | BRANCH | Fix comment added a non-adjacent quote pair; tr -d model only inert-safe | FIXED | 7f533fbb3 |
| 4 | 3 | WARNING | tools/test-postinstall-inline-quoting.sh | BRANCH | False-early-close could pass n-eq-opens silently | FIXED | 1e5a3c5bd |
| 5 | 4 | WARNING | tools/test-postinstall-inline-quoting.sh | SELF/BRANCH | Shape-scope: future differently-shaped inline block escapes oracle+extractor | FIXED (doc) | 3e5211e59 |
| 6 | 5 | WARNING | install/pkg-scripts/postinstall:205 | BRANCH | In-block comment apostrophes load-bearing on outer quote parity | FIXED | 92970d3e9 |

### NITs (non-blocking, all addressed)
- [NIT] glob-unsafe split loop (iter 1) --> `set -f` (511b36c22)
- [NIT] temp-file leak on signal (iter 2) --> trap + mktemp (7f533fbb3, 1e5a3c5bd)
- [NIT] close-pattern assumption undocumented (iter 2) --> comment (7f533fbb3)

### Strengths (across all iterations)
- The `''`->`""` fix is minimal, correct, and complete: block 1 has no empty-pattern cases, block 2's two were the only inline-arg occurrences, every other `''` in the tree is a safe top-level/standalone-file context, and postinstall:99 is correctly left untouched (verified by three reviewers).
- The guard runs the reconstructed inner through a real `/bin/sh -n` rather than pattern-matching the bug string, so it is red-capable for the true regression class; hand-reproduced in scratch (both blocks) in iterations 5 and 6.
- Three layered anti-vacuity checks (opens oracle, `n -eq opens`, positive coverage anchor on the exact guarded lines) plus an honest scope docstring.
- All external tools invoked by absolute path (avoids Homebrew grep/awk dialect drift); wired into `test:shell` in the same commit as the new test (no orphaned-test meta-guard failure).
