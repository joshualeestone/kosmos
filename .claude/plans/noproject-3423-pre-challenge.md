---
pre_challenge: true
method: challenge-loop
branch: noproject-3423
diff_hash: 8faa82e5a54f7d5e68d00a63e6f2258957f9818ae5fce1533f3e3a4982240684
validation: passed
subdir_audit: passed
timestamp: 2026-09-23T02:32:35Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (iteration 1 = the 6.0 fix-and-validate pass; iterations 2 to 5 = fresh blind reviews)
**Converged:** Yes (iteration 5 found zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 6 actionable (1 BLOCKER, 3 WARNINGs, 2 CONVENTIONs) + NITs
**Fixed:** 5 | **Deferred:** 1 (a dead-code removal that would have created a latent mismatch) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial fix-and-validate pass)
**Reviewer model:** n/a (orchestrator validation, no blind agent yet)
**New findings:** 1 BLOCKER
**Self-generated:** 0 (nothing had committed yet)
- [BLOCKER] server.test.js:3082 (lifts web/index.html) -- the tile-write slice is lifted and eval'd against a body-less mock document; the new count-setter auto-exit called boardFilterActive() which is not in that scope -> ReferenceError. --> FIXED (259a143fb): guard both auto-exit calls with `document.body &&` before the function reference, so the `&&` short-circuits in the mock scope and production is unchanged (body always exists).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 CONVENTION (+ 1 NIT)
**Self-generated:** 0 (cited lines predate this loop's fix commits)
- [WARNING] web/index.html card()/lrow() needs_trust branches -- a needs_trust card wears the red visual .attn class but is not marked data-attn, so the Issue filter excludes it. --> FIXED (be94b8ce2): documented the deliberate divergence at the CSS block and pinned it with a needs_trust browser-check arm. Removing the "dead" marker ternaries was DEFERRED: counts.needsYou keys on state regardless of running, so the uniform predicate guarantees filter/count parity at every render path; removing it would create a latent mismatch.
- [CONVENTION] .claude/plans/noproject-3423.md -- em dashes in the committed plan file. --> FIXED (be94b8ce2): removed all em dashes; recorded the needs_trust decision.
- [NIT] the visual .attn class vs data-attn are different sets -> addressed by the divergence comment.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 WARNING (+ 1 NIT)
**Self-generated:** 0
- [WARNING] docs/browser-checks/render-chip-filters-3423.js -- the check exercised markers only on card()/#grid; lrow() (#alist) and onode() (#orgview) carry the same copy-pasted predicate but had no assertion, so a drift there would ship a silent count/filter mismatch. --> FIXED (a9d99282a): added an lrow() direct-call arm and an onode() rendered-DOM arm.
- [NIT] the predicate is inlined 7 times -> correct (extracting breaks the lifted tests); the residual is the drift risk = the WARNING above.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 CONVENTION
**Self-generated:** 0
- [WARNING] docs/browser-checks/render-chip-filters-3423.js -- the "question" divergence was untested: an agent-reported needs_you question renders the calm .question visual (not .attn) but must still carry data-attn to match counts.needsYou. --> FIXED (f640f145f): added a question-divergence arm using classList (not a substring test) so the data-attn marker cannot self-satisfy the visual check.
- [CONVENTION] web/index.html:14141 -- the .board-msgfilter-exit comment still said the exit shows only for the Messages filter, stale after the exit was extended to filter-attn/filter-noproj. --> FIXED (f640f145f): corrected the comment.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION (1 CONVENTION-tagged line was a pass confirmation, not a defect; 3 NITs)
**Self-generated:** 0
**Converged** -- no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | server.test.js:3082 | BRANCH | lifted tile slice: boardFilterActive not defined in mock scope | FIXED | 259a143fb |
| 2 | 2 | WARNING | web/index.html (needs_trust branches) | BRANCH | needs_trust red card excluded from Issue filter, undocumented | FIXED | be94b8ce2 |
| 3 | 2 | CONVENTION | .claude/plans/noproject-3423.md | BRANCH | em dashes in committed plan | FIXED | be94b8ce2 |
| 4 | 3 | WARNING | render-chip-filters-3423.js | BRANCH | lrow/onode marker copies untested (drift risk) | FIXED | a9d99282a |
| 5 | 4 | WARNING | render-chip-filters-3423.js | BRANCH | question divergence untested | FIXED | f640f145f |
| 6 | 4 | CONVENTION | web/index.html:14141 | BRANCH | stale .board-msgfilter-exit comment | FIXED | f640f145f |

### NITs (non-blocking, across all iterations)
- boardFilterActive() has no internal null guard; safe today because every caller guards with document.body first (iteration 5). A one-line internal guard would future-proof it; left as a fast-follow to keep the converged diff minimal.
- the exit class is still named .board-msgfilter-exit though it now clears any board filter; a rename across the 1.2MB file is riskier than the stale name (iteration 5).
- a needs_trust card is hidden under the Issue filter while wearing the red visual; correct call (filter matches the c.needsYou chip count) and pinned by a browser-check arm (iteration 5).

### Strengths (across all iterations)
- data-attn and data-noproj match counts.needsYou / needsYouUnattributed byte-for-byte, including the strict === null (engine/status.js:6882/6890), so the filter can never disagree with the chip count.
- the lifted-test hazard is handled by construction: the tick() auto-exit calls short-circuit on document.body before referencing the top-level filter functions.
- setBoardFilter is a single source of truth for mutual exclusivity; setMsgFilter is preserved as a behavior-identical back-compat wrapper for its two existing callers.
- the browser-check pins all three render families plus both divergences (needs_trust and agent-question) with failable controls.
- accessibility is uniform: role/tabindex/aria-pressed + Enter/Space/Spacebar on all three filter tiles.
