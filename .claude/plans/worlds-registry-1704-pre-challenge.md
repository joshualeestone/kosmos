---
pre_challenge: true
method: challenge-loop
branch: worlds-registry-1704
diff_hash: 3cebabf2eb6f46b10b8bb65dcd856ebd0548ab9daffeb0d280b6289ffbd33c68
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T02:43:48Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 3 WARNINGs, 8 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 2 WARNINGs + 5 NITs | **Deferred:** 1 WARNING (slice-2) + 3 NITs (slice-2/cosmetic)

Validation: full suite 4436/4436 on a quiet box (an unwired-export orphan flagged
by engine.reachable.test.js was resolved via the gate's sanctioned EXCUSED
mechanism -- see below). Subdir CLAUDE.md audit: no CLAUDE.md in the diff, clean.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs (2 slice-2 WARNINGs surfaced, deferred), 3 NITs, 6 STRENGTHs
- Release gate confirmed AIRTIGHT (no-registry -> default -> no overrides -> legacy roots unchanged).
- [NIT] dead ternary `version: x===1?1:1` --> FIXED to `version: 1`.
- [NIT] `base` field stored but unread (misleading) --> ADDRESSED: documented informational-only.
- [NIT] safeKey error message at the API --> DEFERRED to slice 2.
- [WARNING] no cross-process registry lock (createWorld/setActiveWorld read-modify-write) --> DEFERRED to slice 2 (unwired slice cannot hit it); recorded in plan.
- [WARNING] AGENT_WORKFORCE_LAUNCH not overridden (launchd collision when a named world runs agents) --> DEFERRED to slice 2; recorded in plan.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs, 1 STRENGTH
- [WARNING] readRegistry did NOT re-sanitize ids from disk: a hand-edited worlds.json with a traversing id ("../../evil") survived the filter and would escape the store via worldBaseDir's path.join --> FIXED: a CLEAN_ID (/^[a-z0-9_-]+$/) filter drops non-clean ids on read; perturbation-verified control test.
- [NIT] createWorld docblock overstated a name-collision check --> FIXED (id-dedup subsumes it).
- [NIT] file-present half of the release gate untested --> FIXED: added a persisted-registry no-override test.

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs, 1 STRENGTH
- [WARNING] the traversal guard lived only on the read path; a slice-2 caller obtaining a world from another source could reach worldBaseDir's join unguarded --> FIXED: moved the CLEAN_ID assert INTO worldBaseDir (#1798 "guard the result, not each caller"), so the guard travels with the join; perturbation-verified.
- [NIT] plan said "11 tests" (was 14) --> FIXED.
- [NIT] readRegistry does not dedup by id --> DEFERRED to slice 2 (safe; UI-surfacing only).
**Converged** -- the release gate is airtight, the traversal hole is closed on both the read path AND the join, and the remaining items are honestly deferred to slice 2.

### Post-convergence gate resolution (engine.reachable.test.js)
The full-suite validation then failed on engine.reachable.test.js: `setActiveWorld`
is a tested export with no caller (slice 1 is the registry module; its switch/create/
list operations are wired into the board API + startup in slice 2). Resolved via the
gate's own sanctioned option ("wire it to a screen, or excuse it here with a reason
someone can check") -- an EXCUSED entry mirroring the existing `setRelay` precedent
(a validated-but-not-yet-wired export). One self-referential trap was hit and backed
out: the first excuse text listed the sibling function names verbatim, and because
that file is scanned into the tested set, naming them made them newly-flagged
orphans; the reason was rewritten without the literal names, with an NB documenting
the trap. Full suite then 4436/4436.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | NIT | engine/worlds.js | dead version ternary | FIXED | `version: 1` |
| 2 | 1 | NIT | engine/worlds.js | `base` stored-but-unread | FIXED | documented informational |
| 3 | 1 | NIT | engine/worlds.js | safeKey error at API | DEFERRED | slice 2 (plan) |
| 4 | 1 | WARNING | engine/worlds.js | no registry write lock | DEFERRED | slice 2 (plan); unreachable unwired |
| 5 | 1 | WARNING | engine/worlds.js | launchd not per-world | DEFERRED | slice 2 (plan); named worlds don't run agents in v1 |
| 6 | 2 | WARNING | engine/worlds.js | read-path id not sanitized (traversal) | FIXED | CLEAN_ID filter + control |
| 7 | 2 | NIT | engine/worlds.js | docblock name-collision overstated | FIXED | reworded |
| 8 | 2 | NIT | test | file-present gate untested | FIXED | added test |
| 9 | 3 | WARNING | engine/worlds.js | guard only on read path | FIXED | assert in worldBaseDir (#1798) |
| 10 | 3 | NIT | plan | stale test count | FIXED | 14 |
| 11 | 3 | NIT | engine/worlds.js | no dedup on read | DEFERRED | slice 2 (cosmetic) |

### Strengths (across iterations)
- The release gate is structural, not care-based: no-registry AND file-present-default both route through envOverridesFor(default) -> {} -> applyActiveWorldEnv mutates nothing; tests assert byte-for-byte env equality AND resolved-root == legacy control.
- Env-override values verified against each root's real contract (dataRootFor APP-append; projects/workers verbatim; the mkdir matches).
- Traversal closed on BOTH the write path (safeKey) and the read path (CLEAN_ID filter) AND the join (worldBaseDir assert); both guards perturbation-verified.
- readRegistry never throws; self-heals default-present + active-valid; writeRegistry atomic (tmp+rename).
- Deferred items honestly recorded in the plan for slice 2 (write lock, launchd isolation, API error translation, dedup).
