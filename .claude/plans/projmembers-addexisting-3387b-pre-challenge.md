---
pre_challenge: true
method: challenge-loop
branch: projmembers-addexisting-3387b
diff_hash: d00720e9314c4f99337c8bf39fd2417727e47a0ffc9c3e1d576be54fad23acb9
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T19:33:58Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 found zero new BLOCKERs/WARNINGs/CONVENTIONs)
**Total findings:** 3 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT) + 1 synthetic (surface gate)
**Fixed:** 2 | **Deferred:** 1 (the NIT) | **Asked:** 0

Fixes the dead "+" on Project Members that Josh hit live on 0.6.88: the
consolidated agents column now groups as "Project Members" (top + opens the
add-member modal) whenever a project is OPEN, not only once it already has one
of the board's agents on it. An empty-members state shows a two-way honest hint.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**Baseline (6.0) validation:** FAILED on the browser-check surface gate (#2518):
the diff touches the `lrow` token that `render-dm-badges-2863.js` asserts.
Resolved (BRANCH origin) with a `Browser-check-surface: render-dm-badges-2863.js`
override trailer, because the diff only ADDS `lrow` calls in the new branch and
does not change what `lrow` renders (DM badges unaffected). Gate confirmed
passing directly.
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [WARNING] web/index.html (empty-members hint) — "No agents on this project yet"
  is false in the mismatch state this PR fixes (the project HAS members, just not
  on this board): copy asserting a state the data contradicts (CLAUDE.md conv 5)
  --> FIXED (commit 8a6bd67c): split into two honest states, and scenario 9 now
  asserts the off-board wording (and that it does NOT say "no agents yet").
- [NIT] the "Project Members" head over a members-less list with everyone under
  "Other Agents" is slightly odd double-labeling --> DEFERRED: deliberate,
  plan-documented (keeps both the add-existing + and New agent reachable); Josh
  is the design decider and sees it in 0.6.89. Row below.

#### Iteration 2
**Reviewer model:** sonnet (different model, per 6a)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Converged** — the reviewer traced every reachable empty-state combination
(openProj null / agents undefined / empty array / non-empty no-overlap /
non-empty with overlap) and confirmed accurate non-contradictory copy in each;
found no head/+ desync; hexdump-verified the U+2019 apostrophe and no em/en dash;
confirmed scenario 9's regex matches the shipped copy; ran the browser-check
(32 passed).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | (synthetic) | surface-gate | BRANCH | lrow surface-token staleness vs render-dm-badges-2863.js | FIXED | 8a6bd67c (override trailer) |
| 2 | 1 | WARNING | web/index.html empty-members hint | BRANCH | copy claimed "no agents yet" when off-board members exist | FIXED | 8a6bd67c |
| 3 | 1 | NIT | web/index.html grouped-empty render | BRANCH | "Project Members" head over members-less list is odd double-labeling | DEFERRED | Deliberate/plan-documented; Josh decides in 0.6.89 |

### Outstanding questions (ASKED)
None.

### NITs
- The empty-Project-Members + "Other Agents" double-labeling (iteration 1) — kept
  deliberately so the add-existing + and New agent both stay reachable; open to
  Josh's preference.

### Strengths
- The `inProj && inProj.size` discriminator routes every empty-state combination
  to accurate, non-contradictory copy (iteration 1 & 2).
- No desync between the "Project Members" head and the + handler; the flat/tab
  paths and the real-on-board-members case are byte-for-byte unchanged (iter 2).
- Scenario 9 exercises the exact bug (members exist, none on board) and now guards
  the copy accuracy; 32 pass; surface-map + gate satisfied (iter 1 & 2).
