---
pre_challenge: true
method: challenge-loop
branch: dealarm-class2-2808-v2
diff_hash: e4877a09b77f5bf403ee190fbdcc78be6ccabcaa4ff0246953d5fa75044dbe70
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T01:41:00Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Iteration 9 — post-rebase confirming pass

After iteration 8 converged, the branch was rebased onto current origin/main (db8b27b9d), which
merged two ADDITIVE collisions with a parallel #3051 browser-check: `tools/browser-checks.sh` (runner
list — now carries BOTH `render-user-menu-3051` and `render-needsyou-dealarm-2808`) and
`browser-checks-reason-grep.test.js` (EXPECTED_SITES 110→114, EXPECTED_CATCH_SITES 78→82 = base + both
checks' +2/+2). The rebase orphans the diff_hash, so a fresh blind review + full validation re-ran on
the rebased HEAD: **zero actionable findings**, full suite + the reason-grep self-recompute + the
Playwright check all green, surface gate overridden. diff_hash refreshed to the rebased value above.
`git rerere` replayed the two-file resolution across the later iteration commits automatically.

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8 found zero new actionable findings after deduplication)
**Total findings:** 15 actionable (1 BLOCKER, 9 WARNINGs, 2 CONVENTIONs, 3 NITs kept) + repeated STRENGTHs
**Fixed:** 12 | **Deferred:** 3 (the count-tile/pill split; 2 NITs) | **Asked:** 0

Reviewer models alternated Sonnet/Opus every iteration (kosmos#2032), so convergence was witnessed by both models, not one out of ideas. Card #2808 class 2: de-alarm an agent's OWN deliberate needs_you question (self-report by:'agent') to a calm "Has a question" treatment across every per-agent surface that reads the shared cardStOf (home card, list row, org node, project-member row, detail panel); class-1 (by:'auto'), scraped, and unknown-provenance stay red. The fleet/project COUNTS deliberately still count class-2 as red (documented deferral, a Josh product call).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first review; 6.0 passed)
- [BLOCKER] tools/capture-agent-card.js — scrubStrings would corrupt the new stateReportedBy on the next re-capture (fixture was null, accidentally safe) --> FIXED (a2fb759df)
- [WARNING] web/index.html — de-alarm blast radius (org node + project-member row) under-documented + unverified --> FIXED (a2fb759df)
- [WARNING] docs/browser-checks/render-talk.js — a comment quoted fixture strings my re-capture churned stale --> FIXED (a2fb759df)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 CONVENTION, 1 NIT
**Self-generated:** 0 (the CONVENTION was on a build-commit comment line, classified BRANCH)
- [CONVENTION] web/index.html:13815 — STATE_COPY.question comment referenced a removed `isAgentQuestion` helper --> FIXED (1840ed797)
- [NIT] web/index.html — detail panel omitted from the plan's blast-radius list --> FIXED (1840ed797)
- [WARNING] engine/status.js count tile — a class-2 counts red while its card is calm; reviewer confirmed this is the documented deferral, not a defect --> DEFERRED (dup of the plan's weakest premise)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs
**Self-generated:** 0 (both on build-commit lines, BRANCH)
- [WARNING] web/index.html:14617 — boardMods comment claimed a "calm ground"; .acard.question is a border only (correct design) --> FIXED (9d6128d72)
- [WARNING] web/index.html:21695 — a class-2 org node dropped the ", needs you" accessible-name suffix with nothing replacing it (screen-reader gap) --> FIXED (9d6128d72, added ", has a question")

#### Iteration 4
**Reviewer model:** opus
**New findings:** 2 WARNINGs (one a real production gap)
**Self-generated:** 0 (findings on build-commit lines, BRANCH)
- [WARNING] engine/projects.js — the project-member surface did NOT de-alarm in production: reverting the deferred count split also dropped the member stateReportedBy carry needed for pjMember's render --> FIXED (79174646, one-line describe() carry)
- [WARNING] docs/browser-checks/render-needsyou-dealarm-2808.js — the pjMember arm fabricated stateReportedBy directly, an input describe() never supplies, masking the gap above --> FIXED (79174646, added a real production-path test in projects.test.js)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 NIT
**Self-generated:** 0 (capture header prose predates the loop; classified BRANCH)
- [WARNING] tools/capture-agent-card.js:40,44 — header prose said "three ENUM re-pins"; stateReportedBy makes it four --> FIXED (3f3bb90c)
- [NIT] engine/status.js:6033 — paneless comment said "pane card above"; it is below --> FIXED (3f3bb90c)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 1 CONVENTION
**Self-generated:** 0 (comment on a build-commit line, BRANCH)
- [CONVENTION] engine/status.js:6031 — paneless comment claimed a class-2 paneless question "stays alarmed"; panelessCard reconciles through the same reconcileReport, so it IS calmed (comment wrong, behavior correct) --> FIXED (4ecde70a)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 0 (READ_BY_PROJECTS predates; org-aria was iter-3's fix, a loop commit, but the finding is a MISSING test, not the aria line itself)
- [WARNING] fixture-discipline.test.js:95 — READ_BY_PROJECTS tripwire not updated when describe() began reading stateReportedBy --> FIXED (f9ba5f63)
- [WARNING] web/index.html:21715 — the org-node hasQuestion aria fold shipped untested --> FIXED (f9ba5f63, source-pattern test in web.orgchart-glow-2839, the established style since LAST is not reassignable)
- [NIT] tools/capture-agent-card.js — stateReportedBy ENUM has no selfreport export to cross-check (pre-existing asymmetry) --> DEFERRED (no export exists to check against)
- [NIT] web/index.html:1639 — .ask glyph has no WCAG contrast check --> DEFERRED (Mona restyle; label in audited ink, glyph aria-hidden)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 actionable (1 NIT, already-documented)
**Self-generated:** 0
**Converged** — the only finding was the org-node sighted-user calm-affordance NIT, which is the documented Mona-restyle deferral (dedup). Zero BLOCKER/WARNING/CONVENTION; 4 STRENGTHs re-verified the full wiring chain, controls, and deferral in code.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/capture-agent-card.js | BRANCH | scrubStrings corrupts stateReportedBy on re-capture | FIXED | a2fb759df |
| 2 | 1 | WARNING | web/index.html | BRANCH | blast radius under-documented/unverified | FIXED | a2fb759df |
| 3 | 1 | WARNING | docs/browser-checks/render-talk.js | BRANCH | comment quotes churned fixture strings | FIXED | a2fb759df |
| 4 | 2 | CONVENTION | web/index.html:13815 | BRANCH | comment refs removed isAgentQuestion helper | FIXED | 1840ed797 |
| 5 | 2 | NIT | .claude/plans | BRANCH | detail panel omitted from blast radius | FIXED | 1840ed797 |
| 6 | 2 | WARNING | engine/status.js countAgents | BRANCH | count tile red while card calm | DEFERRED | documented weakest premise (Josh + PigeonPete) |
| 7 | 3 | WARNING | web/index.html:14617 | BRANCH | boardMods comment "calm ground" overstates | FIXED | 9d6128d72 |
| 8 | 3 | WARNING | web/index.html:21695 | BRANCH | org node dropped a11y state suffix | FIXED | 9d6128d72 |
| 9 | 4 | WARNING | engine/projects.js | BRANCH | pjMember de-alarm broken in production | FIXED | 79174646 |
| 10 | 4 | WARNING | docs/browser-checks/render-needsyou-dealarm-2808.js | BRANCH | pjMember arm vacuous (fabricated input) | FIXED | 79174646 |
| 11 | 5 | WARNING | tools/capture-agent-card.js:44 | BRANCH | header "three ENUM re-pins" stale | FIXED | 3f3bb90c |
| 12 | 5 | NIT | engine/status.js:6033 | BRANCH | "pane card above" wrong direction | FIXED | 3f3bb90c |
| 13 | 6 | CONVENTION | engine/status.js:6031 | BRANCH | paneless "stays alarmed" comment wrong | FIXED | 4ecde70a |
| 14 | 7 | WARNING | fixture-discipline.test.js:95 | BRANCH | READ_BY_PROJECTS tripwire not updated | FIXED | f9ba5f63 |
| 15 | 7 | WARNING | web/index.html:21715 | SELF | org-node hasQuestion aria untested | FIXED | f9ba5f63 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs / deferrals (non-blocking)
- [DEFERRED] engine/status.js countAgents / project pill — whether the red "Needs you" COUNT tile + project pill should also drop a class-2. Deferred (reshapes #763 attribution + #1253 measurement; ambiguous ruling) pending Josh's product call + Mona (design) + PigeonPete (#1253). The plan names this the weakest premise.
- [DEFERRED] web/index.html:1639 — .ask glyph WCAG contrast, part of Mona's restyle; label text in audited ink + glyph aria-hidden, so low risk.
- [NIT] tools/capture-agent-card.js — stateReportedBy ENUM cross-check vs selfreport (no export exists; pre-existing asymmetry).
- [NIT] web/index.html:21715 — org node has no calm VISUAL affordance for a class-2 (sighted-user asymmetry); screen-reader signal is present; Mona restyle item.

### Strengths (across all iterations)
- The de-alarm routes through ONE shared derivation (cardStOf/stateCopyOf/glyphOf), so all five per-agent surfaces move together by construction (no drift).
- Load-bearing negative controls throughout (auto/operator/null/undefined/working-by-agent stay red; class-1 project-member keeps its triangle; computed-border-color-differs arm), verified by every reviewer.
- The production-path test drives real selfreport.record -> projects.list (not a fabricated member), catching the exact gap iteration 4 found.
- The safe direction is preserved everywhere: only the KNOWN by:'agent' is calmed; the Answer button + counts stay on raw a.state==='needs_you'.
