---
pre_challenge: true
method: challenge-loop
branch: member3state-2711
diff_hash: bea610ffc0351ec966c565ade0ec66f28fbf21166adcd2bf15fc2b60d0a2c811
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T06:31:09Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind passes (opus, sonnet, opus)
**Converged:** Yes (iteration 3 found zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 8 (0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs)
**Fixed:** 4 | **Deferred:** 4 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 (ITER_COMMITS empty on the first pass)
- [WARNING] consolidated-layout hover also outranked by the state-hover rules --> FIXED (854b9715): it is intended (state hue survives hover in both layouts); made the comment say so.
- [NIT] web/index.html:33290 the inline (m.present || restarting) expression left un-refactored --> FIXED (854b9715): reuse the `present` const (Convention #5).
- [CONVENTION] plan filename omits -<timestamp> --> DEFERRED: matches every sibling plan; the gate keys on the branch prefix, so it is satisfiable.
- [NIT] strict-vs-truthy split (needsYou uses === true, wash uses truthy present) --> DEFERRED: harmless (engine emits Boolean present; projects.js:839 sets present: Boolean(card)), and the two gates serve different purposes.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (findings on pre-existing lines and on the new CSS, none authored by a loop fix commit)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] the green/red washes are literal copies of .acard.working/.acard.attn (Convention #5: pin duplicated facts equal) --> FIXED (f77481f8): added a colour-pin test asserting the member washes equal the .acard colours; proven to red on a drift mutation.
- [NIT] idle gray has no documented "why" --> FIXED (f77481f8): added a one-line rationale.
- [NIT] test STATE_COPY hand-typed vs pageConstSource --> DEFERRED: consistent with the sibling pjMember test's established pattern, verified harmless.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** - no new actionable findings.
- [NIT] the STATE_COPY stub comment claimed coverage of rate_limited (it relied on the unknown fallback) --> FIXED (bb8f275d): named rate_limited in the stub so the comment is literally true.
- [NIT] the colour-pin guards only base/light rules (a dark-only override could drift undetected) --> FIXED (bb8f275d): noted the light-only scope in the test.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:~4898 | BRANCH | consolidated hover also outranked (intended) | FIXED | 854b9715 |
| 2 | 1 | NIT | web/index.html:33290 | BRANCH | inline present expr un-refactored | FIXED | 854b9715 |
| 3 | 1 | CONVENTION | .claude/plans/member3state-2711.md | BRANCH | plan filename no timestamp | DEFERRED | sibling-consistent; gate satisfiable |
| 4 | 1 | NIT | web/index.html:33239 | BRANCH | strict-vs-truthy present | DEFERRED | harmless; different gates |
| 5 | 2 | WARNING | web/index.html:4901 | BRANCH | wash colours duplicate .acard | FIXED | f77481f8 (colour-pin test) |
| 6 | 2 | NIT | web/index.html:4906 | BRANCH | idle gray undocumented | FIXED | f77481f8 |
| 7 | 2 | NIT | server.test.js:7313 | BRANCH | STATE_COPY hand-typed | DEFERRED | sibling-consistent, harmless |
| 8 | 3 | NIT | server.test.js:7309 | BRANCH | stub comment coverage claim | FIXED | bb8f275d |

### NITs (non-blocking, across all iterations)
- inline present expr (iter 1) - FIXED
- strict-vs-truthy present (iter 1) - deferred, harmless
- idle gray undocumented (iter 2) - FIXED
- STATE_COPY hand-typed (iter 2) - deferred, sibling-consistent
- stub comment coverage claim (iter 3) - FIXED
- colour-pin light-only scope (iter 3) - FIXED (noted)

### Strengths (across all iterations)
- State->class mapping correct with a `|| ''` fallback; presence gate coincides exactly with the #2699 needs-you gate (projects.js sets present: Boolean(card)), so the red wash reinforces #2699 and can never diverge from its triangle (iters 1, 2, 3).
- CSS specificity verified by hand in both layouts: the (1,4,0) state-hover rules beat the tab-view (1,3,0) and consolidated (0,4,2) neutral hovers, so the state hue survives hover everywhere (iters 1, 2, 3).
- No bleed onto #pjs-members / #pj-add-agents: every rule scoped to #pj-one-agents, though pjMember emits the class for all present members (iters 1, 2, 3).
- rgba-over-var(--k-surface) mirrors the acard light/dark pattern; .unseen and pjm-* mutually exclusive by construction (dashed border preserved) (iters 1, 2, 3).
- Real-fixture tests (fleet.install + projects.create/list), two negative controls (present-neutral + unseen ghost), an absence-assertion CSS-presence guard, and a colour-pin honouring Convention #5 (iters 1, 2, 3).

### Scoping note (recorded, not a finding)
Item 16 lists three sub-parts; this PR ships (a) the 3-state washes. (b) remove box
stroke and (c) remove member status lines are DEFERRED because (c) conflicts with
Josh's same-day #2699 (needs-you red triangle + text on this surface) and (b) would
erase the .unseen dashed border. Both want Josh's pixel review; documented in the plan.
