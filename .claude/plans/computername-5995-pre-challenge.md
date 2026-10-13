---
pre_challenge: true
method: challenge-loop
branch: computername-5995
diff_hash: 2279afe52ef2b068d015c328cf2019b97c25cee6f32684c136757a4bf1be682c
validation: full validation at 9b4888434 (2026-10-13 01:22 CDT; node 19866 tests, 19631 pass, 0 fail, 235 skipped; shell 232/232), red only on its last step, the browser-check surface gate; that gate alone exits 0 at a158331ef (the per-check trailer). All four browser checks exit 0 at 80d8c9a16 (10:06 CDT; 238 PASS, 0 FAIL). NOT rerun at the final head: the full suite, the mutants.
subdir_audit: passed
timestamp: 2026-10-13T15:08:25Z
iterations: 19
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 19 blind reviews, default model and sonnet in turn. Every round, with what was taken and what was not, is in `.claude/plans/computername-5995.md`.
**Converged:** at round 12, again at 14 (after two unused wrappers were removed), and at 19 (after the design review's two changes): 0 BLOCKER, 0 WARNING, 0 CONVENTION.

### Commits no reviewer has read
- 80d8c9a16: the hint's font set explicitly in `web/index.html`. Three readers, two reviewers and I, had reasoned from the CSS that the hint was 12px; a browser measured 13, because a rule on `p` inside a panel out-ranks the hint's class. The fix was checked by measurement, [13, 12], not by another reading.
- The plan-only commits after it.

### Mutants
32 mutants across the engine, the server route and the page, in throwaway worktrees (at 2d417473b and after); 31 red by name. One is known green and stated in the plan: removing the first of two places that say "this is the computer's own name, keep nothing" is invisible to this suite, because it differs from the second only on a computer whose own name starts with a hyphen or holds a direction mark.

### Design review
Mona Lisa approved the shots at a158331ef with two changes, both taken, and approved again (on #5995).

### Not verified
Nobody has seen this on a running board. A real sign-in to the live coordinator with a changed name has not been done. The branch is 187 commits behind main with no conflict; CI tests the merge.

### Per-Iteration Breakdown
Counts as each reviewer gave them. What each finding was, and what was done with it, is in the plan under the same round number.

#### Iteration 1 (default)
[WARNING] x4, [CONVENTION] x3, [NIT] x3. FIXED (a damaged remote.json blocked the start; an untouched box wrote a file; the page's words beside a box that had read no name).

#### Iteration 2 (sonnet)
[WARNING] x3, [CONVENTION] x1, [NIT] x2. FIXED. Superseded in part by the redesign at iteration 4.

#### Iteration 3 (default)
[WARNING] x2, [CONVENTION] x2, [NIT] x6. FIXED. Superseded in part by the redesign at iteration 4.

#### Iteration 4 (sonnet)
[WARNING] x3, [CONVENTION] x1, [NIT] x3. FIXED by a design change: the name rides the sign-in start and is kept only after it.

#### Iteration 5 (default)
[WARNING] x4, [CONVENTION] x2, [NIT] x4. FIXED.

#### Iteration 6 (sonnet)
[WARNING] x2, [CONVENTION] x1, [NIT] x3. FIXED.

#### Iteration 7 (default)
[BLOCKER] x1, [WARNING] x3, [CONVENTION] x4. FIXED. The round that showed what the unrun full suite was hiding.

#### Iteration 8 (sonnet)
[WARNING] x3, [NIT] x3. FIXED or answered in the plan. The first round after the rebase onto main.

#### Iteration 9 (default)
[WARNING] x3, [CONVENTION] x5, [NIT] x4. FIXED.

#### Iteration 10 (sonnet)
[WARNING] x2, [NIT] x3. FIXED.

#### Iteration 11 (default)
[WARNING] x3, [CONVENTION] x2, [NIT] x4. FIXED. Two warnings were against a strip added one round earlier.

#### Iteration 12 (sonnet)
[WARNING] x1, [NIT] x4, nothing new. Converged.

#### Iteration 13 (default)
[WARNING] x2, [NIT] x5. FIXED. After two wrappers only tests called were removed.

#### Iteration 14 (sonnet)
[NIT] x3. Converged.

#### Iteration 15 (sonnet)
[NIT] x6 over two passes, on the two changed browser checks.

#### Iteration 16 (default)
[BLOCKER] x1, [CONVENTION] x2, [NIT] x3. FIXED. After the design review's two changes.

#### Iteration 17 (sonnet)
[WARNING] x1, [NIT] x2. FIXED.

#### Iteration 18 (default)
[CONVENTION] x1, [NIT] x4. FIXED.

#### Iteration 19 (sonnet)
[NIT] x2, neither applied (both are couplings the code's own comments already state). Converged: 0 BLOCKER, 0 WARNING, 0 CONVENTION.
