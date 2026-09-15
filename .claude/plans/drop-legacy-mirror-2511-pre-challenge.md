---
pre_challenge: true
method: challenge-loop
branch: drop-legacy-mirror-2511
diff_hash: ec0cd4bef0dbab5a622b1edb587379a5d1c022f1083104e34963375db6512479
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T06:59:09Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 surfaced zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 3 NITs
**Fixed:** 3 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first reviewer pass; 6.0 passed clean)
- [WARNING] engine/boardauth.js:164 — removal safety rests on the documented "fleet all post-#2439" premise; a stale pre-#2439 bundle reading the legacy leaf directly finds nothing after mirror removal (the #2509 freeze window) --> DEFERRED: documented, deliberate, reversible residual (Renet enumerated the live fleet all post-#2439; dormant boxes re-update on reconnect). NOT fixable in the new bundle (old code does not run new code). Noted in the code comment and the PR body.
- [CONVENTION] .claude/plans/ — no plan file for this branch --> FIXED (85b094079): wrote .claude/plans/drop-legacy-mirror-2511.md.
- [NIT] engine/boardauth.js:143 — orphaned `/** Read the token file... */` docblock sat above legacyTokenPath() (a pre-existing misplacement), mislabeling the function beneath it --> FIXED (85b094079): relocated the docblock to directly above readToken().

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 1 of the above (the plan-filename CONVENTION cites the plan file this loop's iteration-1 fix created; the WARNING and NIT cite BRANCH lines)
**Duplicates of prior findings:** 0 (the iter-2 WARNING is a DISTINCT residual from iter-1's — permission maintenance, not an empty legacy leaf)
- [WARNING] engine/boardauth.js:163 — removing mirrorTokenToLegacy() also removes its permission self-heal (chmod 0o700/0o600, #1968) for a board.token a pre-#2511 build already wrote into the legacy leaf; nothing re-tightens its mode any more --> FIXED (6664b1705): documented the residual in the code comment at the removal site AND in the plan's residual-risk section. Rejected deleting the legacy board.token (would strip the #2509 read-fallback safety net, opposite of this card's kept-read-fallback design); rejected re-tightening from new code (re-introduces legacy-leaf writes, exactly what this change removes). The file is READ-only from the new code, so the exposure is an external mode-loosening event on a deprecated path holding an already-owner-only credential.
- [CONVENTION] .claude/plans/drop-legacy-mirror-2511.md:1 — plan filename omits the `-<timestamp>` suffix the written convention specifies --> DEFERRED: 802 of 1055 existing plan files (~76%) omit the timestamp, including the just-merged #3098 (deploy-guard-3073.md); the pre-challenge-gate and the challenge-loop plan-file search both key on `<branch>`, not the timestamp, so the name is functionally correct. Same call the #3098 loop made on the identical finding.
- [NIT] engine.boardauth-leaf-2509.test.js:49 — the no-write-mirror test overlaps in spirit with the sibling no-resurrect test --> no change: the overlap is intentional, red-capable coverage of two distinct conditions (legacy dir present vs absent).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
**Converged** — five STRENGTHs: clean removal (no dangling refs, never exported, sole real caller server.js:13292 unaffected), the docblock relocation fixes a real pre-existing misplacement, read fallback + backfill retained and still covered, both rewritten tests genuinely red-capable against a mirror regression, the guard test is armed in CI (run-tests.sh globs `engine/*.test.js *.test.js` + the #1934 count assertion), and comment/plan accuracy holds against the code (the residual is stated correctly, not overstated — the retained backfill self-heal only chmods the PRIMARY leaf, never the legacy one).
- [NIT] .claude/plans/drop-legacy-mirror-2511.md:60 — the manual-run note slightly undersells that the full suite already covers this file via its `*.test.js` glob + the #1934 count assertion --> no change (reviewer: minor, no change needed).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/boardauth.js:164 | BRANCH | old-bundle reads empty legacy leaf after mirror removal (#2509 window) | DEFERRED | documented residual; reversible; not fixable in new bundle |
| 2 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan file for branch | FIXED | 85b094079 (wrote plan) |
| 3 | 1 | NIT | engine/boardauth.js:143 | BRANCH | orphaned docblock mislabels legacyTokenPath() | FIXED | 85b094079 (relocated to readToken) |
| 4 | 2 | WARNING | engine/boardauth.js:163 | BRANCH | legacy-leaf board.token permission self-heal (#1968) removed with the mirror | FIXED | 6664b1705 (documented; delete + re-tighten both rejected with reasons) |
| 5 | 2 | CONVENTION | .claude/plans/drop-legacy-mirror-2511.md:1 | SELF | plan filename omits -<timestamp> | DEFERRED | ~76% of plans omit it; gate keys on branch; #3098 precedent |
| 6 | 2 | NIT | engine.boardauth-leaf-2509.test.js:49 | BRANCH | no-write test overlaps no-resurrect test | no change | intentional red-capable coverage |
| 7 | 3 | NIT | .claude/plans/drop-legacy-mirror-2511.md:60 | SELF | manual-run note undersells CI coverage | no change | reviewer: minor, no change needed |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] engine/boardauth.js:143 — orphaned docblock (iteration 1, FIXED).
- [NIT] engine.boardauth-leaf-2509.test.js:49 — overlapping-coverage note (iteration 2, no change).
- [NIT] .claude/plans/drop-legacy-mirror-2511.md:60 — manual-run note undersells CI coverage (iteration 3, no change).

### Strengths (across all iterations)
- mirrorTokenToLegacy() removal is surgical and complete; it was never exported, so no external caller breaks; sole real caller boots via ensureToken() -> ensureTokenPrimary() unaffected (iterations 1, 3).
- Read fallback, legacy->primary backfill, legacyTokenPath(), and store.LEGACY_APP all retained and still exercised by tests (iterations 1, 3).
- Both rewritten tests are genuinely red-capable against a mirror regression (existsSync legacy board.token === false; stale legacy copy stays untouched), matching the old mirror's exact write conditions (iterations 1, 2, 3).
- The guard test is armed in CI, not orphaned (run-tests.sh `*.test.js` glob + #1934 count assertion) (iteration 3).
- Comment/plan accuracy verified against the code; the residual is stated correctly, not overstated (iteration 3).
