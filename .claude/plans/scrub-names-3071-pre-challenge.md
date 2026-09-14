---
pre_challenge: true
method: challenge-loop
branch: scrub-names-3071
diff_hash: ae2ababa764adc8d2362f75d1d6a69d5ef2c3fb0d779cafc85d4ce767dded419
validation: passed
subdir_audit: passed
timestamp: 2026-09-14T21:18:16Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (blind reviewers), plus a clean 6.0 baseline
**Converged:** Yes - iteration 3 found 0 NEW BLOCKER/WARNING/CONVENTION, no unresolved ASKED
**Total findings:** 3 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 6 NITs (+ many STRENGTHs)
**Fixed:** 2 BLOCKER + 3 WARNING + 4 NIT | **Deferred:** 1 BLOCKER-class(N/A), 1 CONVENTION, 2 NIT | **Asked:** 0

Model coverage (kosmos#2032): opus (iter 1, 3) + sonnet (iter 2). Sonnet caught two real
BLOCKERs both opus passes missed - a concrete win for varying the reviewer model.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 (first reviewer pass; ITER_COMMITS empty)
- [NIT] no-name-refs-3071.test.js - `\bben\b` treats `_` as word char, so ben_cat/cat_ben slip --> FIXED (c862bf80: boundary now (?<![a-z0-9])..(?![a-z0-9]))
- [NIT] no-name-refs-3071.test.js - negative controls omit the rename targets --> FIXED (c862bf80: added lilpixel/Lil Pixel/roo/pixel/reuben)
- [NIT] no-name-refs-3071.test.js - positive control uses .some(), not per-pattern --> FIXED (c862bf80: added per-pattern control)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 3 of the above (the two name-guard findings + the render-board NIT touch iteration-1 / branch lines; classified per 6c-bis)
**Duplicates of prior findings:** 0
- [BLOCKER] no-brand-refs-1881.test.js:112 - `'$' + 'STUFF'` spells STUFF contiguously (self-allowlist hid it from CI) --> FIXED (145841335: ('$' + ROOT_B).toUpperCase())
- [BLOCKER] no-name-refs-3071.test.js hitsIn - raw-NUL binary gate silently exempts 5 real source files that embed a literal NUL (worldimport.js, a11ystatus.js, +3) --> FIXED (145841335: U+FFFD-after-decode detection; source-with-NUL scans, true binaries skip; newly-scanned files verified name-clean)
- [WARNING] discovery-fixtures - "Casey" scrubbed inconsistently (out-of-scope name; internal fleet agent, 458 uses, cannot be guarded) --> FIXED (145841335: reverted standalone-Casey edits to consistency; Ben-paired clauses genericized as the Ben-scrub)
- [WARNING] discovery-fixtures - "Josh's sister" scrubbed inconsistently (out-of-scope) --> FIXED (145841335: reverted, keeping in-scope lilnacho->lilpixel)
- [WARNING] no-name-refs-3071.test.js - substring patterns lacked a false-positive tradeoff note --> FIXED (145841335: added note; sheila is also Australian slang)
- [CONVENTION] commit subjects b1b9a4d2e/3299a377d use `(#N)` form, not `<branch> -- <msg>` --> DEFERRED: the repo squash-merges (main commits carry a `(#PR)` suffix), so intermediate subjects collapse into the PR title, which is set to the conventional `scrub-names-3071 -- ...` form. Rewording non-head commits needs an interactive rebase for zero effect on what lands.
- [NIT] render-board-signin-403-2023.js:14 - 147-char line from a collapsed comment --> FIXED (145841335: rewrapped)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** - no new actionable findings. Reviewer independently replicated both full guard
scans over all 3342 tracked files (0 name offenders, 0 brand offenders), scanned the
NUL-containing source files directly (clean), verified U+FFFD detection both arms, verified the
boundary regex, and recomputed the FNV-1a name-corpus buckets.
- [NIT] discovery-fixtures/README.md - doc now labels external real files "Lil Pixel" though they are really "Lil Nacho" --> DEFERRED: inherent, acceptable consequence of scrubbing a name that also labels external artifacts (reviewer: "not a defect"); keeping the real name defeats the scrub.
- [NIT] no-name-refs-3071.test.js - substring FP tail --> DEFERRED: documented, by-design, zero collisions in tree (same trade the brand-guard makes).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | no-name-refs-3071.test.js | SELF | underscore slips \bben\b | FIXED | c862bf80 |
| 2 | 1 | NIT | no-name-refs-3071.test.js | SELF | neg controls omit rename targets | FIXED | c862bf80 |
| 3 | 1 | NIT | no-name-refs-3071.test.js | SELF | per-pattern positive control | FIXED | c862bf80 |
| 4 | 2 | BLOCKER | no-brand-refs-1881.test.js:112 | BRANCH | '$'+'STUFF' contiguous | FIXED | 145841335 |
| 5 | 2 | BLOCKER | no-name-refs-3071.test.js hitsIn | SELF | raw-NUL gate skips real source | FIXED | 145841335 |
| 6 | 2 | WARNING | discovery-fixtures | BRANCH | Casey scrubbed inconsistently | FIXED | 145841335 |
| 7 | 2 | WARNING | discovery-fixtures | BRANCH | "Josh's sister" inconsistent | FIXED | 145841335 |
| 8 | 2 | WARNING | no-name-refs-3071.test.js | SELF | no FP-tradeoff note | FIXED | 145841335 |
| 9 | 2 | CONVENTION | commits b1b9a4d2e/3299a377d | SELF | subject form | DEFERRED | squash-merge uses PR title |
| 10 | 2 | NIT | render-board-signin-403-2023.js:14 | BRANCH | 147-char line | FIXED | 145841335 |
| 11 | 3 | NIT | discovery-fixtures/README.md | BRANCH | external files labeled Lil Pixel | DEFERRED | by design (scrub side effect) |
| 12 | 3 | NIT | no-name-refs-3071.test.js | SELF | substring FP tail | DEFERRED | by design, documented |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking)
- All NITs from iterations 1-2 were fixed; iteration 3's two NITs are deferred by design (see ledger).

### Strengths (across all iterations)
- Fragment-based brand-guard de-literalization is byte-equivalent at runtime (escaping preserved); verified char-by-char (iter 1, 2, 3).
- U+FFFD binary detection verified both arms: source-with-NUL scans, true binaries skip (iter 3).
- Underscore-aware first-name boundary catches the regrowth vector \b would miss; rejects bench/beneath/reuben (iter 1, 3).
- server.test.js name-corpus ben->roo recomputed via the real FNV-1a discIndex: all 7 buckets still hit, coverage assertion unaffected (iter 2, 3).
- git mv preserved history (92% similarity); every casing/spacing/hyphen discovery property preserved; no dangling old-filename references (iter 1, 2, 3).
- Both guards armed (root *.test.js glob + kosmos#1934 coverage assertion); independent full-tree replication found 0 name + 0 brand offenders across 3342 files (iter 3).
