---
pre_challenge: true
method: challenge-loop
branch: org-hover-target-2683
diff_hash: bc15a80f6f3a3b010f3c2209f6623a9ed2801ad7b95c05aafcb3f47203e5fe25
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T09:08:02Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4, a blind Opus pass, found zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 3 blocking (3 WARNING) + several NITs
**Fixed:** 3 blocking (plus NITs) | **Deferred:** a few NITs | **Asked:** 0

The fix for kosmos #2683 (org-chart hover mis-targeting) went through a real design correction in
the loop. The first draft made the `.onode .callout` unconditionally `pointer-events:none`; that
fixes the reported neighbour mis-fire but leaves the visible gold-pill callout looking pressable
while inert, which violates the standing #284 ruling. Iteration 3 caught it, and the fix became:
scope `pointer-events:auto` to the VISIBLE state (`.onode:hover .callout, .onode:focus-visible
.callout`), with base `none` from the shared rule. An invisible callout is inert (mis-targeting
fixed); a visible callout is pressable (#284 honoured). Model alternation earned its keep: Opus (2)
caught a vacuous test regex, and Opus (4) plus Sonnet (3) drove the #284 correction.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [NIT] the dedicated `.onode .callout { pointer-events: none }` rule was redundant with the shared rule --> FIXED: removed it, relocated the #2683 comment (e59b3fc2)
- [NIT] plan claims a browser-run I could not re-verify in a read-only review --> informational

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the WARNING was on the source-pin I wrote in iteration 1's fix e59b3fc2)
- [WARNING] the positive pointer-events:none source-pin used `[\s\S]*?`, which bridges `}` boundaries and could pass vacuously by matching a later rule's declaration --> FIXED: bounded to one rule with `[^}]*?`, proven can-fail (0d87516f)
- NITs: spelling-specific negative guard (acceptable), layout-dependent browser control (acceptable), comment indentation --> fixed/deferred

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (both on the initial design + a pre-existing comment)
- [WARNING] the unconditional `pointer-events:none` left the visible gold pill looking pressable but inert -- a #284 violation --> FIXED: scoped `auto` to the visible :hover/:focus-visible state (a608612d)
- [WARNING] a pre-existing "legibly pressable" comment became stale under the unconditional-none draft --> RESOLVED by the visibility-scoped fix (the visible callout is pressable again)
- [NIT] the browser hover control exercises only node[0] (layout-dependent) --> acceptable; the CSS source-pin is the geometry-independent guard

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** -- no NEW actionable findings.
- [NIT] the rewritten comment dropped the rationale for why `.oname` is deliberately pointer-events:none (overlapping rest-labels eating clicks) --> FIXED: restored a one-line note (ca05530a, comment-only, behaviour unchanged)

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | NIT | web/index.html | BRANCH | redundant .onode .callout pointer-events:none rule | FIXED | e59b3fc2 |
| 2 | 2 | WARNING | web.org-view.test.js | SELF | positive guard used [\s\S], could bridge rule boundaries and pass vacuously | FIXED | 0d87516f |
| 3 | 3 | WARNING | web/index.html | BRANCH | unconditional pointer-events:none left the visible gold pill inert (#284 violation) | FIXED | a608612d |
| 4 | 3 | WARNING | web/index.html | BRANCH | stale "legibly pressable" comment | FIXED | a608612d (resolved by the visibility-scoped fix) |
| 5 | 4 | NIT | web/index.html | BRANCH | lost .oname pointer-events rationale | FIXED | ca05530a |

### Outstanding questions (ASKED)
None.

### NITs (deferred, non-blocking)
- render-org-chart.js hover control exercises node[0] only (layout-dependent). Acceptable: the fix
  is a single global CSS change and the geometry-independent CSS source-pin in web.org-view.test.js
  is the real regression guard.
- The negative source-pin keys on the exact removed spelling of the bare `auto` override.
  Reasonable; it guards that spelling, and a differently-spelled re-add is a different change.

### Strengths (across all iterations)
- Correct root-cause fix: an opacity:0 element with pointer-events:auto still captures the pointer,
  so scoping auto to the visible state makes an invisible callout genuinely inert (mis-targeting
  fixed) while keeping the visible pill pressable (#284 honoured).
- Chevron removed cleanly with no dangling references (co-go gone from render, CSS, comments).
- Tests are can-fail and well-anchored: source-pins bounded by [^}] (no vacuous bridge), the
  negative guard line-anchored so the comment's verbatim quote of the old rule is not read as live,
  and the browser check reads real invertible runtime values (none at rest / auto when visible /
  one callout on hover / detailOpen=true).
- Accessibility intact: the button keeps its aria-label, the removed chevron was aria-hidden.

### Note on validation
node --test: 6079 tests, 0 failures. Several intermediate 6g runs recorded transient failures under
fleet contention -- `tools/test-cut-guard.sh` (a concurrent `tools/test-install.sh` holding the
install-gate port) and `codex-report-bridge.test.js` #1139 (a timing test that flakes under machine
load); both pass in isolation and the runner's footer flags "green alone is contention". The final
clean validation (hash bc15a80f6f3a, in a low-load window) recorded node 0-fail, `cut guard: 0
failures`, and the browser-check surface gate passing (render-org-rings-2576.js overridden by a
per-check trailer: the callout/chevron change does not touch the node context rings that check
asserts). 6j skipped against that clean entry on an unchanged, clean worktree.
