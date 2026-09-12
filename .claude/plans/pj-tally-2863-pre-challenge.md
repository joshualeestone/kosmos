---
pre_challenge: true
method: challenge-loop
branch: pj-tally-2863
diff_hash: 2607e298cecf0605cd0b9f61989e9ab4da27947bbac3403eb24bff26200aee3a
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T09:41:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 5 (0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 2 NITs)
**Fixed:** 2 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (general-purpose default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 1 of the above (the em-dash CONVENTION was in the plan file this loop's setup step had just written)
- [CONVENTION] .claude/plans/pj-tally-2863.md — Five em dashes in the plan file; house style bans em dashes anywhere in output. --> FIXED (commit ebc02a34)
- [NIT] web.pj-tally-2863.test.js:19-23 — archived-exclusion boundary not directly asserted --> DEFERRED (see NITs)

Note: Step 4 also raised the standing "no plan file for this branch" CONVENTION during
setup; a plan file was authored and committed (2d563453) before iteration 1's reviewer ran,
so the reviewer correctly saw a plan file present.

#### Iteration 2
**Reviewer model:** sonnet (a different model from iteration 1, per kosmos#2032)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (both cite pre-existing code, not this loop's fix commits)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] web/index.html pjMapNode — On the Map/org-tree layout, the tally can show a nonzero total with no per-node badge visible to explain it. --> DEFERRED (by design; see Final Ledger)
- [NIT] web.pj-tally-2863.test.js:66-74 — the suite does not independently pin the shared .dmtile-g glyph CSS --> DEFERRED (see NITs)
**Converged** — no new actionable (BLOCKER/WARNING/CONVENTION) findings survive deduplication and deferral.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | setup | CONVENTION | .claude/plans/ | BRANCH | No plan file for branch | FIXED | plan file authored + committed (2d563453) |
| 2 | 1 | CONVENTION | .claude/plans/pj-tally-2863.md | SELF | 5 em dashes in plan file | FIXED | ebc02a34 (commas/hyphen; no shipped code affected) |
| 3 | 1 | NIT | web.pj-tally-2863.test.js:19-23 | BRANCH | archived-exclusion boundary not directly asserted | DEFERRED | the test regex is anchored to `active.reduce`, so a regression to `PROJECTS.reduce` breaks `assert.ok(m)`; the `!p.archived` filter itself is pre-existing shared code (one-derivation with st-pj and pjTreeRows) |
| 4 | 2 | WARNING | web/index.html pjMapNode | BRANCH | Map layout: tally can be nonzero with no per-node badge on screen | DEFERRED | By design and by #2863's own scoping. The tally is a correct rollup of real unread; the missing Map/org-node badge is the "org-node badge" that #2863 explicitly lists as separate follow-up work (and the plan's Scope records as deferred). The merged agents twin (#2888) shipped with the identical property (tile total before its list-view badge placement) and was accepted. Adding badges to the Map renderer is out of scope for the tally tile. |
| 5 | 2 | NIT | web.pj-tally-2863.test.js:66-74 | BRANCH | suite does not independently pin the .dmtile-g glyph CSS rule | DEFERRED | `.dmtile-g` is a shared class already asserted by the twin (web.dm-tally-2863.test.js:73); noted for a trivial follow-up if the suite should be made self-sufficient |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web.pj-tally-2863.test.js:19-23 — archived-exclusion boundary not directly asserted (iteration 1); mitigated: regex anchors `active`, filter is pre-existing shared code.
- [NIT] web.pj-tally-2863.test.js:66-74 — glyph CSS not independently pinned (iteration 2); mitigated: shared class guarded by the twin test.

### Strengths (across all iterations)
- The tally is summed client-side from the same `active` array the cards render from, so the tile structurally cannot disagree with the visible per-card badges (one-derivation, convention #5). PJ_CURRENT exclusion, null/negative to 0, and hide-at-zero all match the per-card `unreadBadge` and `ringNewMessages` exactly. (iteration 1 + 2)
- Complete write-site symmetry: the tile is written in exactly the two places its sibling tiles are (`paintProjects` and `pjTilesUnknown`), including the failed-read `?`-and-hidden reset, placed before `paintProjects`'s early empty-state returns so an emptied board resets the count. (iteration 1)
- Sub-project inclusion is correct and tested: `active` is a flat array holding parent and child rows alike, so the flat reduce covers nested badges without special-casing. (iteration 2)
- The test extracts and evaluates the real `pjDmTotal` reduce from source rather than a paraphrase, and scopes the failed-read assertion to the `pjTilesUnknown()` function body specifically. (iteration 1 + 2)
