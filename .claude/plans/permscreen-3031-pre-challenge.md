---
pre_challenge: true
method: challenge-loop
branch: permscreen-3031
diff_hash: 1566e036bbc235373caef09d20015726752478efc94d538ac3033ae1997d3c20
validation: "node suite clean (0 fail of 7363); full shell suite SIGTERM-killed under fleet contention, unrelated to this web-only diff, deferred to CI on a clean runner"
subdir_audit: passed
timestamp: 2026-09-14T15:13:02Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (6.0 initial validation counts as iteration 1)
**Converged:** Yes, witnessed by two reviewer models (opus + sonnet)
**Total findings:** 3 actionable (1 BLOCKER, 1 WARNING, 1 CONVENTION) + 3 NITs
**Fixed:** 3 actionable + 2 NITs | **Deferred:** 1 NIT (pre-existing, Josh in-app pass) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** n/a (validation pass, not a blind agent)
**Self-generated:** 0
- [BLOCKER] web/index.html (S2 CSS comment) — the comment contained an angle-bracket token that web.consolidated-980.test.js's markup-balance parser (strips HTML comments and script bodies, NOT CSS comments) counted as an unclosed tag; body child-depth ended at 1 not 0. --> FIXED (9e8d63af2), reworded to drop the angle brackets.

#### Iteration 2 (first blind review)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 0 NITs
**Self-generated:** 0 of the above (both are pre-existing prose the redesign staled, BRANCH)
- [WARNING] web/index.html:9463 — stale HTML comment above the markup still said "six previews... tmux's three and Kosmos's three" and cited only #2911. --> FIXED (5fa914e4b): reworded to the two-preview reality (guarded by the browser-check's exactly-two arm) + #2911/#3032.
- [CONVENTION] docs/browser-checks/README.md:331 — surface-map row documented the old six-preview / two-group / per-folder arms. --> FIXED (5fa914e4b): rewritten for the two-preview structure, no-wrap guard, and side-by-side guard.

#### Iteration 3 (second blind review)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** — no new actionable findings on a second, different model.
- [NIT] render-firstrun-access-onebox.js:182 — the side-by-side guard comment said "the 1280px viewport hides this", but .fr-box's max-width:40rem caps the modal at ~552px content regardless of viewport. --> FIXED (cb69c4584): comment reworded to say the pin decouples the guard from future .fr-box width changes.
- [NIT] .claude/plans/permscreen-3031.md — "the descriptive comment" (singular) undersold that two comments were rewritten. --> FIXED (cb69c4584).
- [NIT] web/index.html:9417 — no explicit min-width floor for a single stacked preview below ~200px, where the nowrap button row could overflow. --> DEFERRED: pre-existing risk (the old six-up grid carried it too), not a regression; a sub-200px single-column install pane is implausible for a Mac installer window (.fr-box caps at 640px), and the plan's weakest-premise already flags pane-width variance for Josh's in-app pass.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html (S2 CSS comment) | BRANCH | angle-bracket token in CSS comment broke markup-balance parser | FIXED | 9e8d63af2 |
| 2 | 2 | WARNING | web/index.html:9463 | BRANCH | stale six-preview HTML comment + only-#2911 citation | FIXED | 5fa914e4b |
| 3 | 2 | CONVENTION | docs/browser-checks/README.md:331 | BRANCH | surface-map row documents old six-preview arms | FIXED | 5fa914e4b |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking)
- render-firstrun-access-onebox.js:182 — guard comment precision (FIXED cb69c4584)
- .claude/plans/permscreen-3031.md — comment-count wording (FIXED cb69c4584)
- web/index.html:9417 — narrow-column (<200px) button-row overflow floor (DEFERRED: pre-existing, Josh in-app pass)

### Strengths (across iterations)
- The side-by-side guard pins the real ~552px pane width (matching .fr-box's 40rem cap + .fr-body padding exactly) and asserts equal tops + differing lefts, catching the 320px-wrap regression the first cut shipped rather than false-passing at the 1280px viewport.
- Removal is properly guarded: the dead .s2-dlgrow/.s2-appcount rules are fully gone with zero dangling references; .s2-appgrp/.s2-applbl/.s2-grpnote remain only as absence assertions in the browser-check.
- The real grant flow is untouched: .s2-gate-row/.s2-allow unchanged, both previews keep .s2-mockallow, the #fr-pane-2 handler still resolves to the single .s2-allow, and web.tmux-box-1214.test.js's prefix assertion still matches. No em dashes introduced.
- The browser-check has 11 non-vacuous arms per engine (structure, names, generic copy, trimmed labels, compact sizing, button counts, no-wrap, equal-height, mock affordance, ring, side-by-side layout).
