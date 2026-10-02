---
pre_challenge: true
method: challenge-loop
branch: swarmdesc-4871
diff_hash: b8995ab4e1c482c5aa1d572f2f88dfed078c7852244d21a1b6a98acc6a65dbc5
subdir_audit: passed
timestamp: 2026-10-02T01:22:44Z
converged: true
validation: passed (full tools/run-tests.sh on Mortals at c6e6c241a, hash b8995ab4e1c4, 2026-10-02T01:11:09Z)
---

## Challenge loop: blind reviewers, Opus and Sonnet alternating, until a round found nothing new

Ledger in `.claude/plans/swarmdesc-4871.md` (Review rounds). Commits per round: ea3d24b32 (1), 36326287a (2), 8169478d6 (3),
aab1af746 (4), 8c4e69647 (5), 797b2a758 (6), 22f25653b (7), c6e6c241a (8). The final round found no new BLOCKER,
WARNING or CONVENTION.

## [WARNING] round 1, FIXED: the advice pattern erred toward hiding a disclaimer
Widened (counsel, legal, tax, financial planner, doctor, physician, clinician, therapist, diagnos*, veterinar*), new
wordings pinned in the test.

## [WARNING] round 2, FIXED: plurals and professions the list missed
CPA, auditor, nurse, pharmacist, psycholog*, psychiatr*, dentist, licensed, "taxes", "lawyers"; an accepted false keep
is pinned so it is a decision, not an accident.

## [WARNING] round 4, FIXED: the path-keyed line depended on a later repaint
paintPathOptions calls paintPickLimit; round 5 pinned it (removing the call reds the test).

## [WARNING] round 6, FIXED: every built-in role's caution runs through the real function on both paths
Single keeps all; every built-in disclaimer survives the swarm path. DEFERRED (W): reach cautions go on the swarm path
too, by Josh's own 10-01 example; engine/roles.js says so.

## [WARNING] round 8, FIXED: a superseded roles answer that keeps the old menu keeps the line under it
A Legal pick keeps its disclaimer.

## Decided, recorded on the card
The partial removal (professional-advice disclaimers stay, the rest go on the Create a Swarm path) is the documented
call on #4871, with a one-line reversal for Josh.

## Validation
Full suite on Mortals for this exact diff hash (13,737+ node tests, 0 failed; browser-check surface gate green with
its per-check trailer for the CSS-comment token).
