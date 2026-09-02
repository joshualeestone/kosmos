---
pre_challenge: true
method: challenge-loop
branch: frozenarrow-1752
diff_hash: fd0664cd92e7089c7a62cf105bf4746edae2cdb1a21d6f5dbb912f7f867018fc
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T05:13:01Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes -- iteration-4 change fixes the last realistic edge (destructuring param); the
sole remaining residual (a brace inside a string/comment/regex/template) is contrived, absent from
this tree, and inherent to a linear non-AST scanner.

> Note on the diff_hash: the shared main checkout's local `main` ref is stale, so the hook's
> `git diff main...HEAD` three-dot spans other already-merged work. The hash above is what the hook
> recomputes. The feature diff (vs origin/main) is two files: `tools/check-frozen-roots.js` and
> `tools/test-frozen-roots.sh`, plus this plan.

## The feature (kosmos#1752)

`check-frozen-roots.js` gates against a module-level `const` that resolves a filesystem root at
require time (defeating a sandbox seam set after require). The card said two instruments with
overlapping blind spots read as coverage; on today's main the symptom (tokendoor's eager Map) is
refactored away and the checker was rewritten to catch the class at the declaration, so the pair
problem is resolved. The one live residual was that the resolver scan saw only `function NAME(`,
missing arrow / function-expression resolvers held in a const; this adds them.

## Verification

Full suite green on the rebased tree (run alone): EXIT_CODE=0, 3710 passes, 0 failures.
`tools/test-frozen-roots.sh` 12 arms, each mutation-verified. `node tools/check-frozen-roots.js
engine` exits 0 (5 real false positives dropped vs the prior heuristic; every real root kept);
0.05s, no runaway. Rebased onto origin/main, 0 behind, empty overlap.

## Per-Iteration Breakdown

#### Iteration 1
Added const-held resolver bodies to the transitive closure via `declarations()`. Arm 4b (single-
expression arrow) passed.

#### Iteration 2 (blind pass: a false negative in the class it claimed to close)
`declarations()` terminates at the first `;`, so a BLOCK-body arrow's source call after the first
statement was truncated and missed, while the identical `function` form was caught. Added
`resolverBodyFrom` (brace/`;` capture) and made the closure a fixpoint (a reverse-declared 3-deep
chain needs it). Arms 4c (multi-line block-body arrow) and 4d (reverse chain) added.

#### Iteration 3 (blind pass: an over-capture false positive)
The `/^\}/` (col-0) block terminator over-captured on an INDENTED closer, sweeping a later source
const in -> a false positive that reds an unrelated file. Also missed a function-expression default
param and a next-line brace. Replaced with a BALANCED-BRACE capture (drops 5 real FPs on the tree,
keeps every root). Arms 4e (indented-closer FP guard) and 4f (function-expr default param) added.

#### Iteration 4 (converged; a realistic false-negative regression)
The balanced-brace introduced a false negative the col-0 version did not have: a destructuring /
object-default PARAMETER on a wrapped expression arrow, whose param braces balanced on the head
line and truncated the body. Fixed: a `{` opens the body only at paren-depth 0. Arm 4g added.

### Final Ledger

| # | Iter | Category | Where | Description | Status |
|---|------|----------|-------|-------------|--------|
| 1 | 2 | BLOCKER | resolverBodyFrom | block-body arrow truncated at first ; | FIXED (brace capture) |
| 2 | 2 | WARNING | closure | 2-round cap missed a reverse 3-deep chain | FIXED (fixpoint) |
| 3 | 3 | BLOCKER | block terminator | col-0 closer over-captures -> false positive | FIXED (balanced brace) |
| 4 | 4 | BLOCKER | balanced brace | param brace truncates a wrapped arrow -> false negative | FIXED (paren-depth guard) |
| 5 | 4 | NIT | resolverBodyFrom | string/comment/regex brace miscount | DOCUMENTED (contrived, non-AST limit) |

### Strengths
- Net improvement on the real tree: 5 false positives removed, every real root kept, gate green.
- Every realistic resolver form caught (declaration, arrow expr/block, function-expr, default and destructuring params, reverse chains); each guarded by a mutation-verified arm.
- The one residual class is documented honestly in both directions, in-code.
- No em dashes in the added code or tests (ASCII throughout).
