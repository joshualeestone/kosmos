---
pre_challenge: true
method: challenge-loop
branch: remove-home-discovery-3048
diff_hash: 0729576403a5e25e98cd3c20e78b00615a88c8d0fbd68c434a321bc33da72efd
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T07:33:23Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (reviewer models: opus, sonnet)
**Converged:** Yes
**Total findings:** 5 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs)
**Fixed:** 3 | **Deferred:** 2 | **Asked (awaiting user):** 0

Two independent blind passes on two different models both returned zero actionable
findings (no BLOCKER, WARNING, or CONVENTION). The three iteration-1 NITs were fixed;
the two iteration-2 NITs are the deliberate narrow-removal decision (keep the shared
painters and the `.found-dismiss` precedent CSS) documented in the plan, deferred with
reasoning.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (6.0 passed clean, so nothing had committed before this pass)
- [NIT] web/index.html:47908,47968 — dead `closest('#found-wrap, #scan-wrap')` board-refresh guards in the shared add/undo handlers --> FIXED (commit 331860227): removed; behavior-neutral for firstrun rows, which never matched that selector
- [NIT] docs + 3 kept checks + server.test.js — stale comment pointers to the 3 deleted checks --> FIXED (commit 331860227): repointed to live siblings (render-found-undo.js, render-firstrun-scan-on-grant-1652.js)
- [NIT] browser-checks-reason-grep.test.js:536 — the EXPECTED_SITES/EXPECTED_CATCH_SITES balance is incidental --> FIXED (commit 331860227): documented the emit-count coupling in the new check

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (both cite pre-existing kept code, not this loop's fix commit)
**Duplicates of prior findings (confirmed resolved):** the iteration-1 fixes were verified in place
- [NIT] web/index.html (painters/gating vars) — the kept painters + DISCOVERY_OPENED are now unreachable-with-effect (null-guard to no-op) --> DEFERRED: intentional narrow-removal per the plan; the painters are called typeof-guarded from firstrun's shared .fr-adopt* handlers, and removing those call sites would edit the firstrun handler (the entanglement risk the plan avoids). A follow-up could fully retire the indirection in Angel's lane.
- [NIT] web/index.html:5318 — `.found-dismiss`/`.found-x-say` CSS kept as a documented colour precedent for `.skillrm.armed` --> DEFERRED: intentional per the plan and explained in the adjacent comment; web.ask-first-1683.test.js references `.found-dismiss.armed` as its precedent sibling.
**Converged** — no new actionable findings on a second, differently-modeled pass.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | web/index.html:47908,47968 | BRANCH | dead closest() board-refresh guards | FIXED | 331860227 |
| 2 | 1 | NIT | docs/*, 3 checks, server.test.js | BRANCH | stale pointers to deleted checks | FIXED | 331860227 |
| 3 | 1 | NIT | browser-checks-reason-grep.test.js | BRANCH | emit-count coupling undocumented | FIXED | 331860227 |
| 4 | 2 | NIT | web/index.html (painters) | BRANCH | intentionally-kept dead painters/vars | DEFERRED | narrow-removal per plan; firstrun shares them |
| 5 | 2 | NIT | web/index.html:5318 | BRANCH | .found-dismiss kept as colour precedent | DEFERRED | documented precedent; ask-first-1683 test references it |

### NITs (non-blocking)
- Full retirement of the kept discovery painters/gating vars is a possible follow-up in the found-agents subsystem (Angel's lane), out of scope for a "remove the button" change.

### Strengths (across both iterations)
- The removal is structurally complete: every removed id has no remaining unguarded getElementById/closest reference; the two dead closest() board-refresh guards were removed; the poll-calls, hide-refs, handlers, and home CSS all went together.
- Every kept painter null-guards on its DOM lookups before use, so onboarding S9 is unaffected; firstrun repaints via frFindAgents() independent of the now-no-op home painters.
- render-home-discovery-removed-3048.js is a genuine, non-vacuous absence guard (drives the real poll paint sequence with stubbed candidate data, proven to red on origin/main), correctly wired into the driver in the deleted check's list position; README and fresh-install doc rows accurate.
- The CSS trim to #firstrun-only kept every #firstrun selector byte-identical.
- Both updated unit tests pair a doesNotMatch (removed ids gone) with a positive control (a kept sibling still present), so the assertion slice is proven aimed correctly.
- No em dashes introduced; plan file present and matches the implementation; worktree used; commit messages follow convention.
