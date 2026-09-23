---
pre_challenge: true
method: challenge-loop
branch: needsyou-question-3419
diff_hash: ef0a4db51c9fe569cf65b1a9f33c3ea1ca933142ef330c4933d81ba99acf94ea
validation: passed
subdir_audit: passed
timestamp: 2026-09-23T05:58:53Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (baseline 6.0 passed clean; 3 fresh blind reviewers).
**Converged:** Yes -- iteration 3 surfaced zero NEW BLOCKER/WARNING/CONVENTION (2 NITs, addressed).
**Total findings:** 0 BLOCKER, 3 WARNING, 0 CONVENTION, several NITs.
**Fixed:** all 3 WARNINGs + the actionable NITs. **Deferred:** the NITs below (with reasons). **Asked:** 0.

Reviewer models rotated opus / sonnet / opus (kosmos#2032). The change is small and
additive (one pure helper + one route wiring line + tests); it converged in 3.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 2 WARNING, 0 CONVENTION, 1 NIT
**Self-generated:** 0 (findings on the original branch build, which predates the loop's fix commits)
- [WARNING] server.js -- per-poll `new Date()` `at` churned dmRow's repaint key (midOf=id||at) and re-advanced the DM_SPOKE_AT "just spoke" heuristic every ~5s for a STANDING question --> FIXED (428be78df): stable `id:'needs-you-question:'+agent` + `at:null` (DM_SPOKE_AT loop guards `!m.at` so it skips the row; pjWhen(null) renders nothing; stored msgs carry no id so no midOf collision). Engine-only, no ROOM_NOT_SPEECH dependency.
- [WARNING] no integration test for the wiring --> FIXED: added a server.test.js test (needs_you agent's payload carries the question row, with an idle control).
- [NIT] dedup checks only the trailing row --> DEFERRED (documented in the helper docblock: rare transient double, clears with the state, co-lands with the banner removal; a full-thread scan could over-suppress a legitimately repeated question).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 4 NITs
**Self-generated:** 0 (the flagged line was the original wiring, not a loop-authored fix)
- [WARNING] server.js -- the wiring passed the raw case-tolerant URL `name` as the row identity, not the resolved `card.sessionName`; a mis-cased request would inject from:'Zeta'/id:'...:Zeta' and dmWho's `from===sessionName` compare would render the raw string --> FIXED (ce4ed5c8b): pass `(card && card.sessionName) || name` (card non-null whenever question is; the `||name` only fires on the no-op path).
- [NIT] plan documented the old 4-arg signature --> FIXED (plan updated).
- [NIT] id prefix a bare literal --> FIXED (NEEDS_YOU_QUESTION_ID_PREFIX constant, convention #2).
- [NIT] redundant setDryRun(false) after setRunner --> DEFERRED (consistent with the file's arm() pattern; harmless).
- [NIT] dedup ignores last.from --> DEFERRED (documented tradeoff, re-flagged as still-visible).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NITs
**Self-generated:** 0
- [NIT] no test for a MIS-CASED URL (a silent revert to `name` would stay green) --> FIXED (c7bfd9a13): added a mis-cased assertion (GET /api/agent/Zeta/thread -> row from/id are canonical 'zeta'), pinning the card.sessionName decision.
- [NIT] em dashes in the plan + added code comments --> plan swept to `--` (c7bfd9a13); code-comment em dashes DEFERRED (they match chat.js/server.js's pervasive em-dash comment convention -- 78+ pre-existing in chat.js -- and are not Josh-facing/shipped; reviewer confirmed not a violation; converting only my lines would make them inconsistent with the file).
**Converged** -- zero NEW actionable findings; 3 STRENGTHs confirming the null-at/stable-id design against every named UI consumer (midOf, DM_SPOKE_AT, pjWhen, threadKey), the provably-safe card.sessionName guard, and the additive/reversible/no-write-on-read wiring with a real idle control.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | server.js/engine/chat.js | BRANCH | per-poll at churned repaint key + DM_SPOKE_AT | FIXED | 428be78df |
| 2 | 1 | WARNING | server.test.js | BRANCH | no integration test | FIXED | 428be78df |
| 3 | 1 | NIT | engine/chat.js | BRANCH | dedup trailing-only | DEFERRED | documented |
| 4 | 2 | WARNING | server.js | BRANCH | raw URL name not canonical sessionName | FIXED | ce4ed5c8b |
| 5 | 2 | NIT | plan | BRANCH | stale 4-arg signature | FIXED | ce4ed5c8b |
| 6 | 2 | NIT | engine/chat.js | BRANCH | id-prefix bare literal | FIXED | ce4ed5c8b |
| 7 | 3 | NIT | server.test.js | BRANCH | no mis-cased test | FIXED | c7bfd9a13 |
| 8 | 3 | NIT | plan/comments | BRANCH | em dashes | FIXED (plan) / DEFERRED (comments) | c7bfd9a13 |

### Deferred (with reasoning)
- Dedup is trailing-only (not a full-thread scan): a full scan risks over-suppressing a legitimately repeated question; the transient double is rare and co-lands with the banner removal.
- Redundant setDryRun(false) after setRunner: consistent with the file's arm() pattern; harmless (tmux() checks runner before DRY_RUN).
- Em dashes in code comments: match chat.js/server.js's pervasive convention, not Josh-facing/shipped; converting only my lines would break consistency with the file.

### Strengths (across iterations)
- The null-`at`/stable-`id` design holds against every named UI consumer: midOf (id||at), DM_SPOKE_AT (guards !m.at), pjWhen(null)->'', threadKey -- no repaint churn, no "just spoke" re-stamp, no timestamp on a standing question.
- The card.sessionName guard is provably safe: question non-null implies card truthy (both gate on asking).
- Additive/reversible/no-write-on-read; the integration test carries a real idle control + a mis-cased canonicalization guard.

### MERGE NOTE (not a challenge-loop concern, but load-bearing)
Merging this ALONE briefly shows the question twice (banner + bubble) until Mona removes the #d-qask banner (her #3419 UI half, after her #3414). This PR is READY (green + converged); its merge CO-LANDS with Mona's UI, not in isolation. Addresses #3419 (non-closing; #3419 is Angel's card, part b).
