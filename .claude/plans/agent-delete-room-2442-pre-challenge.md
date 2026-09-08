---
pre_challenge: true
method: challenge-loop
branch: agent-delete-room-2442
diff_hash: 35e6fdf4eae0291f26328636e089c64479608fa412c69909b204c99b6a2670df
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T22:38:20Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 initial-validation pass (which caught the first approach) + 3 blind independent passes
**Converged:** Yes (iteration 3 returned zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 6 (0 BLOCKERs, 4 WARNINGs, 2 NITs) + 1 synthetic (initial validation)
**Fixed:** 6 | **Deferred:** 1 | **Asked (awaiting user):** 0

Bug #2442 (Josh): "if you delete an agent, he still has access to a project room." `remove.js` is a
SOFT, restorable delete that revokes the sender token (#2323) but does not touch `project.agents`,
and the room-post path did not filter removed agents. The fix filters removed agents from the room's
effective membership at the ACCESS boundary (`engine/messages.js` `sendPost`/`react`/`sweepUnanswered`),
fail-CLOSED, keeping the record so `restore` re-admits.

### Per-Iteration Breakdown

#### Initial validation (6.0) -- caught the first approach
The first implementation filtered removed agents in `projects.js describe()`. The full-suite
validation went RED: it broke the deliberate #166 contract (server.projects.test.js: a removed agent
stays on the board's project row as `present:false`) and the member-fixture-shape test. Treated as a
synthetic BLOCKER: reverted the describe() approach and re-implemented at the room-post/react ACCESS
boundary (the display and the access are different questions; "access" is post/react, not the row
listing). Re-validated green before spawning the blind reviews.

#### Iteration 1 (blind)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 NITs
- [WARNING] messages.js -- `_roomMembers` re-derived isRemoved's cleanName match; a sibling guard uses
  slugFor for #740, and drift would fail in the retains-access direction --> FIXED (069a7147):
  delegated to `remove.isRemoved` (later refined in iter 2).
- [WARNING] messages.js -- `sweepUnanswered` (the #185 room-nudge sweep) is another pane-write path
  that did not respect removal; a partial-removal still-running agent would be nudged --> FIXED
  (069a7147): skip removed agents before the at-most-once nudge-row write.

#### Iteration 2 (blind)
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] messages.js -- the gate ACTS (admits a sender / types into panes), but iter 1's delegation
  to `isRemoved` used the DISPLAY posture (fail-open). remove.js documents that `removedNames()` exists
  so an acting caller can refuse on an unreadable list --> FIXED (f976e8c4): switched to `removedNames()`,
  fail-CLOSED in sendPost/react/sweepUnanswered; removedNames on a MISSING file is {ok:true,names:[]}
  (ENOENT = no removals), so fail-closed fires only on a genuinely corrupt/unreadable list. No longer
  leans on #2323 as the backstop.
- [NIT] messages.test.js -- the fail-open control's comment named removedNames() after the isRemoved
  refactor --> FIXED (f976e8c4): flipped the control to assert fail-CLOSED, removing the stale comment.
- [NIT] server.js heardBy -- a fourth pane-write (task-assignment) exists beyond the three enumerated,
  isNamedOurs-gated --> FIXED (f976e8c4): documented in the plan scope so "sendPost+react+sweepUnanswered"
  reads as the complete ROOM-write set, not every pane-write.

#### Iteration 3 (blind)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] messages.js -- when ALL members are removed, an operator post falls through to the #172
  "nobody is on that project yet" message, slightly imprecise --> DEFERRED (999b4e15): rare
  whole-team-removed edge, harmless, and an accurate new sentence is user-facing copy (Mona's/Josh's
  lane). Recorded in the plan.
**Converged** -- zero actionable findings; four STRENGTHs confirming the security core, the fail-closed
posture, the missing-file safety, and the complete room-write coverage.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 0 | 6.0 | BLOCKER(synthetic) | projects.js/tests | describe() approach broke the #166 present:false display contract | FIXED | reverted -> access-boundary |
| 1 | 1 | WARNING | messages.js | removed-match re-derivation / drift risk | FIXED | 069a7147 -> f976e8c4 |
| 2 | 1 | WARNING | messages.js | sweepUnanswered nudge bypassed removal | FIXED | 069a7147 |
| 3 | 2 | WARNING | messages.js | acting gate used display fail-open posture | FIXED | f976e8c4 (fail-closed) |
| 4 | 2 | NIT | messages.test.js | stale removedNames() comment | FIXED | f976e8c4 |
| 5 | 2 | NIT | server.js | heardBy pane-write not acknowledged in scope | FIXED | f976e8c4 (plan) |
| 6 | 3 | NIT | messages.js | all-removed operator-post wording | DEFERRED | user-facing copy, Mona/Josh |

### Deferred (for operator/Mona)
- Finding 6: the all-removed operator-post message. Deferred as user-facing copy in a rare, harmless edge.

### Strengths (across iterations)
- The security core is correctly closed and fail-CLOSED per remove.js's own documented acting-guard
  principle; a missing removed.json (no-removals) is NOT fail-closed, so normal rooms are unaffected.
- One access boundary (`members` after shape-validation) gates both the sender and the recipient list;
  the match keys on cleanName, the same key isRemoved uses, so the room cannot drift from the fleet's
  one removal check; the record is kept so restore re-admits.
- All perturbation-verified; 396 room-consumer tests green.
