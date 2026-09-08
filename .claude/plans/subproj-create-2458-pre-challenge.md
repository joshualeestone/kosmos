---
pre_challenge: true
method: challenge-loop
branch: subproj-create-2458
diff_hash: 3537db0882281cc161ea6018155777b0564fbb12e22142771a00630e1621b0f7
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T02:28:49Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 5 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs)
**Fixed:** 3 | **Deferred:** 2 | **Asked (awaiting user):** 0

The change: a project can be grouped under a PARENT at creation (and agents added
at creation), so the Create-a-new-project page makes a subproject directly rather
than create-top-level-then-reparent. Engine `create()` accepts an optional
`parent` validated through the SAME `cleanParent` the edit path uses (#1994);
`POST /api/projects` forwards `body.parent`. Origin/main was merged in to pick up
the fleet control-test fix (#2464) and #2463/#2453; that merge is catch-up only
and does not touch the parent logic (verified: my parent change intact, all
#2458 tests green post-merge).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] engine/projects.js - the comment "self-parent and cycle arms structurally
  no-ops at create" overstates: idFor derives the id from the title, so creating
  "Alpha" with parent "alpha" (no such project yet) DOES trip the self-parent arm.
  --> FIXED: corrected the comment (cycle arm cannot fire; self-parent CAN in that
  idFor edge) and added a unit test pinning it.
- [NIT] engine/projects.js - cleanParent calls readAll() again (a second read).
  --> DEFERRED: accepted tradeoff for reusing one shared cleanParent(value, childId)
  identical to the edit path; both reads are before any write.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [WARNING] engine/projects.js - parent validation was placed AFTER makeFolder,
  unlike the name/description body refusals which the file deliberately hoists
  BEFORE makeFolder (the documented 1586 principle), so a folderless caller with a
  bad parent left an empty orphan folder. --> FIXED: hoisted `all`/`idFor`/
  `cleanParent` before makeFolder (one `all` read, reused by the duplicate check);
  a bad parent now refuses with no orphan folder AND no orphan row.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** - reviewer reported the hoist correct with 5 strengths.
- [NIT] engine/projects.js - two readAll() on the grouped-create path (one at the
  hoisted read, one inside cleanParent). --> DEFERRED: deliberate single-validator
  reuse; both before any write, mirrors edit.
- [NIT] engine/projects.js - the self-parent edge ("Alpha"+"alpha") surfaces
  "cannot be its own sub-project" not "no project to group". --> DEFERRED: correct
  refusal with no row, reachable only when the derived id equals the requested
  (nonexistent) parent; documented + test-pinned.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | engine/projects.js | "structurally no-ops" overstates self-parent arm | FIXED | comment corrected + edge test |
| 2 | 1 | NIT | engine/projects.js | cleanParent re-reads readAll | DEFERRED | shared-validator tradeoff |
| 3 | 2 | WARNING | engine/projects.js | parent validated after makeFolder (orphan folder) | FIXED | hoisted before makeFolder |
| 4 | 3 | NIT | engine/projects.js | two readAll on grouped-create | DEFERRED | single-validator reuse, pre-write |
| 5 | 3 | NIT | engine/projects.js | self-parent edge message asymmetry | DEFERRED | correct refusal, documented + tested |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] engine/projects.js - two readAll on grouped-create (iterations 1, 3, deferred)
- [NIT] engine/projects.js - self-parent edge message asymmetry (iteration 3, deferred)

### Strengths (across all iterations)
- Single-definition reuse: create and edit both route parent through one
  cleanParent, so create-time and edit-time rules cannot drift (iterations 1, 2, 3).
- Validation before the write and (after the hoist) before makeFolder, so a bad
  parent refuses whole with no orphan row and no orphan folder (iterations 2, 3).
- Route trust handling correct: body.parent forwarded untrusted, fully validated in
  the engine, a bad parent is a 400 not a 500; made.via derived server-side
  (iterations 1, 3).
- Additive signature; no-parent callers resolve cleanParent(undefined) to null, so
  parent:null stays the default; the id hoist is behavior-preserving (iterations 1, 3).
- Tests cover valid parent, missing-parent-refused-with-no-row (engine + route),
  non-string type error, blank/null/absent top-level, parent+agents in one step, and
  the self-parent-via-derived-id edge (iterations 1, 2, 3).
