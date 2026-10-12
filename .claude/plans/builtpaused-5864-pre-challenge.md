---
pre_challenge: true
method: challenge-loop
branch: builtpaused-5864
diff_hash: 9161e5b480fc35379ace5a1da1313d54801cc5fac81358116455c25f48f05430
validation: passed
subdir_audit: passed
timestamp: 2026-10-12T01:39:32Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 blind passes, models alternated (opus, sonnet, opus, sonnet, opus). Every reviewer was told to run
nothing (other agents' suites were live) and to read committed content only after the first.
**Converged:** Yes. Iteration 5 (opus) returned zero BLOCKER/WARNING/CONVENTION and four NITs, all taken (one adds a
CLI test pinning [on hold] [built] for a task under its own hold in a paused project).

## Per-iteration findings

#### Iteration 1 (opus)
- [WARNING] Both CLIs printed [on hold] [built] while the row grouped built, so --state held disagreed with the
  printed marks. Fixed: [built] [project paused], with a paused-project fixture for the route and both CLIs.
- [WARNING] CLAUDE.md's Tasks view row still said held is checked first for a paused project. Fixed.
- [CONVENTION] The 5705 test name and a fixture comment gave the old order. Fixed.
- [NIT] No route-level paused fixture; a web comment overstated. Fixed.

#### Iteration 2 (sonnet)
- [CONVENTION] My CLAUDE.md edit left a garbled, duplicated sentence. Fixed.
- [NIT] taskState's header comment never listed held; a web comment. Fixed.

#### Iteration 3 (opus)
- [WARNING] The card's decision promised the row says the project is paused; the CLI did, the board did not.
  Fixed: span.tsk-paused on the row, checked in render-onhold-4771.
- [CONVENTION] No browser check covered the new screen behaviour. Added.
- [CONVENTION] A stale projectPaused field comment. Fixed.
- [NIT] Two comments' wording. Fixed.

#### Iteration 4 (sonnet)
- [WARNING] The browser assertions had one control, so dropping either half of `projectPaused && state ===
  'built'` passed. Fixed: one control per half.
- [NIT] README row, a CSS comment for .tsk-paused, the field comment. Fixed.

#### Iteration 5 (opus)
- No issues found at BLOCKER, WARNING or CONVENTION.
- [NIT] CLAUDE.md sentence order; a web comment; no CLI test of a built task under its own hold in a paused project
  (added: [on hold] [built], no [project paused]); a comment on why the Assigner cannot move a fixture task. All taken.
- [STRENGTH] Every reader of task state (Assigner, nudger, worldview, missedtell, blockBody) checked and consistent.

## Evidence
- Targeted node tests 67/67 (TAP counts); four mutants (old order in taskState, in listGroup, old marks in each CLI)
  each fail exactly their named test.
- render-onhold-4771: 0 FAIL / 98 PASS, light 1400 and dark 390 (its first queued run threw at setup, a fixture
  error of mine, fixed and dry-run before the rerun).
- Full validation, tools/run-tests.sh, on the branch with origin/main merged in: PASSED attempt 1, validation_rc=0,
  audit_rc=0, head a7e407c5e (20:38 CDT).
- Browser-check gate and surface gate: rc=0 on the merged tree.
