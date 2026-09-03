---
pre_challenge: true
method: challenge-loop
branch: plus-gate-1615
diff_hash: b6c63a09ba91a88b1349b1a84e972e17021bc3bfc9c5dadd494ffbfdf7ae5c5d
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T14:31:28Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (plus the 6.0 baseline validation pass, which caught one real issue)
**Converged:** Yes (both blind agents found only one by-design consequence, already deferred)
**Total findings:** 5 (1 BLOCKER from baseline validation, 1 WARNING, 1 CONVENTION, 2 NITs)
**Fixed:** 3 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 0 (baseline validation, 6.0)
**New findings:** 1 BLOCKER, 1 CONVENTION
- [BLOCKER] tools/browser-checks.sh — initial-validation: browser-checks-indexed.test.js (#1387) failed because the new browser-check render-plus-gate-1615.js was in the README but not wired into the runner. --> FIXED (wired into the run_one for-loop next to render-settings-nav)
- [CONVENTION] .claude/plans/ — no in-repo plan file for the branch. --> DEFERRED: the design spec is the plan (Josh-Brain/Projects/kosmos-plus-onswitch-gate-1615-design-spec.md), committed separately per the design-worker workflow.

#### Iteration 1
**New findings:** 1 WARNING, 2 NITs
- [WARNING] web/index.html:23049 — gating the flow on `enrolled` makes the in-flow enrol UI (#plus-enrol) unreachable, and a machine left in on:true/enrolled:false from the prior always-configured build cannot see the off-switch. --> DEFERRED: by design. Enrolment moves to the site + state2 (#1115, Josh's ruling); the edge is functionally inert because the engine's own `wanted` gate (remote.js:201) requires `enrolled()`, so no tunnel runs without enrolment and no live connection is stranded; nobody can pay or enrol yet (#1742, #1886); and the change is strictly removal-direction. Angel chose the `enrolled` gate deliberately and Splinter verified it. Surfaced in the PR body.
- [NIT] web/index.html:22733 — internal CSS comment still read "Plus Account". --> FIXED (updated to "Kosmos Plus").
- [NIT] docs/browser-checks/render-plus-gate-1615.js — a fixed waitForTimeout(400) after the nav click was a mild flakiness surface. --> FIXED (replaced with waitForFunction that waits for exactly one of state1/flow to have real height; a total paint failure now times out rather than false-passing).

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Duplicates of prior findings (confirmed):** 1 (the enrolled-gate WARNING at web/index.html:23049, re-found independently and again judged acceptable/inert; matches the DEFERRED entry).
**Converged** — no new actionable findings; four STRENGTHs confirming the gate change, falsifiable tests, sound browser-check settle condition, and correct runner wiring.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 0 | BLOCKER | tools/browser-checks.sh | new browser-check unwired (#1387) | FIXED | wired into runner |
| 2 | 0 | CONVENTION | .claude/plans/ | no in-repo plan file | DEFERRED | design spec in Josh-Brain is the plan |
| 3 | 1 | WARNING | web/index.html:23049 | enrolled gate makes in-flow enrol unreachable; inert on:true/enrolled:false edge | DEFERRED | by design (#1115/#1742/#1886), inert, removal-direction, team decision |
| 4 | 1 | NIT | web/index.html:22733 | internal comment "Plus Account" | FIXED | updated to Kosmos Plus |
| 5 | 1 | NIT | render-plus-gate-1615.js | fixed-sleep flakiness | FIXED | waitForFunction settle |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web.plus-stale.test.js:3, web.settings-nav.test.js:53 — internal comments still reference "Plus Account" as historical context. Left as-is: non-user-facing, and they describe the section's history rather than a live label; the em-dash/wording rules govern output to the operator, not internal comments.

### Strengths (across all iterations)
- The core gate change is correct and closes a real hole: `configured = Boolean(RELAY())` is permanently true, so the old gate exposed the "Turn on" switch to every user with no paid gate; gating on `enrolled` makes the screen agree with the engine's own connection gate (remote.js:201). No live-tunnel user is stranded (a running tunnel requires `enrolled()`).
- Tests are genuinely falsifiable, pinned in both directions (match `/enrolled !== true/`, doesNotMatch `/r\.configured !== true/`), and the #1012 plus-stale test asserts the stronger flow-hidden guarantee, falsifiable against the pre-change page via PLUS_PAGE=.
- The browser-check (render-plus-gate-1615.js) stubs /api/remote with `configured:true` in BOTH scenarios so the buggy gate would fail it; the settle condition cannot silently false-pass (a total paint failure times out); screenshots both states in both themes.
- The retitle is applied consistently across h2, nav span, and aria-label with the (needs you) visually-hidden text preserved; no a11y or copy regression.
- The runner wiring is correct: render-plus-gate-1615 runs headless (HEADED=0) in the standard self-contained group.
