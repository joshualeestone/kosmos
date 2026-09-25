---
pre_challenge: true
method: challenge-loop
branch: no-conflict-3729
diff_hash: e4fcd67058cff87bceb2ecfedf74a1650831f679479095a4919c3184db25a1c4
subdir_audit: passed
timestamp: 2026-09-25T13:41:44Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (blind reviewers: opus, sonnet, opus)
**Converged:** Yes. Pass 3 found 0 blockers, 0 warnings, 3 nits.

## What changed
- engine/status.js: both card builders send stateConflict: null. The reports-versus-screen sentences
  are still computed (status.conflict) for the engine's own use, and are never copied onto a card.
- web/index.html: the card's conflict line, conflictNote(), the agent page's #d-conflict slot and its
  painter, and the unknown card's "Not the same as idle" note are deleted. The needs-trust note stays.
- New guards: engine/status.no-conflict-3729.test.js (exactly two stateConflict sites, both null,
  comments stripped; controls that the sentences are still computed); web.said-line.test.js absence
  test (no conflictNote, no stateConflict read, no d-conflict; control on stateReported);
  docs/browser-checks/render-no-conflict-3729.js (43 arms, Mac and Windows: every engine sentence
  injected into every /api object with a sessionName, then grid, list, org, agent page, unknown
  agent page, Projects, project members and the one-screen layout checked for any sentence or slot).

## Iteration 1 (opus)
- [WARNING] The unknown card's "Not the same as idle" note is a status sentence on the card too -> FIXED:
  removed (my call, overriding an earlier ruling that kept it; reasoning on
  the card).
- [WARNING] The injection count was not asserted, so a fixture that injected nothing would pass -> FIXED.
- [NIT] Surface proofs and wording -> FIXED.

## Iteration 2 (sonnet)
- [WARNING] Project member boxes had no members in the fixture (arm vacuous) -> a real project with 3 members.
- [WARNING] The needs-trust note was asserted on a card that did not exist -> a real needs-trust agent, with a
  precondition requiring exactly one such card with its note.
- [NIT] Preconditions per surface; stale comments -> FIXED.

## Iteration 3 (opus): no blockers, no warnings
- [NIT] The browser check reads innerText, so a sentence in a title= or aria-label would pass it. Covered by
  web.said-line.test.js, which fails on any page code reading stateConflict (reviewer confirmed).
- [NIT] The sentence list is read from single-quoted strings in engine/status.js; a double-quoted future
  sentence would be missed. The engine test's always-null assertion covers the real risk.
- [NIT] Settings' members list still shows an unknown member's reason. Kept deliberately: it is a list row
  giving a reason, not a card status line, and its comment states why. Recorded on the card.

## Measured
- Browser check against main's web/index.html: 16 FAIL (reviewer reproduced). On the branch: exit 0.
- Reviewer perturbations, each red: member box printing stateConflict; needs-trust note deleted; unknown
  note restored; list row printing stateConflict.
- Engine: 8,800 reconcileReport combinations, 4,160 produced a conflict sentence (7 distinct); none
  reached because, evidence or any other text field.
- Full suite PASSED on 343a9d61 (validation-log, rc=0). The earlier cf09d137 run: 9283 tests, 0 failed.

## Weakest premise
- Removing the unknown card's note overrides an earlier ruling that kept it. Josh's #3729 words are
  about the conflict line; I read "nothing can be injected there" as covering every status sentence
  slot on the card. One line to restore if that reading is wrong.
