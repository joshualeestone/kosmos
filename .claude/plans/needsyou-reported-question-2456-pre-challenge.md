---
pre_challenge: true
method: challenge-loop
branch: needsyou-reported-question-2456
diff_hash: e60a664d6ebe93a24d324baa66a3ba6a576918769b0c635b19f38e38f5f0ebb1
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T17:56:30Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (no new actionable findings on iteration 3, witnessed by two models)
**Total findings:** 4 actionable (0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, plus 1 recurring NIT-class about deploy transition)
**Fixed:** 2 | **Deferred:** 1 | **Asked (awaiting user):** 0

The change makes the agent-detail and project-thread "question region" fall back to
an agent's REPORTED needs_you sentence (the card's own `because`, the same words the
header quotes) when the live tmux pane no longer shows the question, instead of the
"we cannot find the question on its screen right now" banner that contradicted a
header quoting it. The live pane still wins whenever it has an extractable question.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION (dup of the seeded plan-file finding), 2 NITs
**Self-generated:** 0 of the above (first reviewer pass; ITER_COMMITS empty because 6.0 passed)
- [WARNING] server.js:7542/9799 (+web/index.html) -- the reported fallback shows possibly-stale reported words, and the agent-page label was neutral so those words shown in the screen-styled box could read as the live screen --> FIXED (commit 8f6af66c): made the agent-page label source-aware ("This is what it told us it needs:"), symmetric with the project room, so both surfaces frame reported words as reported. The underlying behavior is intended: a reported needs_you does not decay (reconcile rule 6), so it stands as the real question until the agent resolves it; the live pane wins when it has one.
- [CONVENTION] .claude/plans/ -- no plan file for this branch --> DEFERRED: the design and rationale are documented on card #2456 and in the commit be54465c body; a sibling plan needsyou-working-2456.md covers the OTHER half of the card (the already-merged classify position-gating #2465), not this fallback.

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per the rotation)
**New findings:** 0 BLOCKERs, 1 WARNING, 1 NIT; CONVENTION re-raised (dup, confirmed resolved as DEFERRED)
**Self-generated:** 0 of the above (the finding was a MISSING test; iteration 1 committed only web/index.html, so no cited line was loop-authored)
- [WARNING] server.projects.test.js -- no end-to-end route test for the reported + live-trust-dialog seam (a self-report coexisting with a live trust dialog) --> FIXED (commit 7a91e696): added a regression test proving reconcile makes the dialog LEAD (reported:false), so the reported-question fallback stays excluded and the pane's dialog shows with its answerNote. Also added clearReport to withAgent's finally (symmetric with withThread) so the report the test writes cannot leak.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs; 1 CONVENTION (dup, plan file) and 1 NIT (dup, deploy transition) both deduplicate against already-recorded findings
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings; the gate, precedence, single-sourcing and test hygiene were all independently confirmed correct.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | No plan file for this branch | DEFERRED | Documented on card #2456 + commit be54465c body |
| 2 | 1 | WARNING | server.js:7542/9799, web/index.html | BRANCH | Reported words could read as the live screen on the agent page (neutral label) | FIXED | 8f6af66c |
| 3 | 2 | WARNING | server.projects.test.js | BRANCH | No route-level test for the reported + live-trust-dialog seam | FIXED | 7a91e696 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html -- a LIVE pane PROSE question (no numbered menu) still shows the "Answer by sending the number" hint. Pre-existing (the old line was `hidden = false`), out of scope for #2456; the reported branch now correctly hides it. (iteration 1)
- [NIT] server.projects.test.js -- the secondary arms are split across routes (generic-placeholder + questionBecause-null on the project route; live-pane-wins + no-menu on the agent-DM route). The CORE "reported shows the question" is tested on both routes; the paths are near-identical, so the asymmetry is low-value to duplicate. (iteration 1)
- [NIT] server.projects.test.js -- the project-route tests wrap in withEngMode(true) while the agent-thread tests do not; cosmetic, since eng-mode gates only the served viewport, never the question derivation. (iteration 2)
- [NIT] server.js/web/index.html -- the additive `question.reported` field means an un-upgraded cached client during a deploy transition briefly renders the old label; inherent to any additive field, self-heals on web reload, and server + web deploy together. (iterations 1 and 3)

### Strengths (across all iterations)
- ASKING_GENERIC is genuinely single-sourced: value-identical to the four literals it replaces, exported and compared as one symbol by both routes, no surviving copies (iteration 1, confirmed 2 and 3).
- The gate is correct and defense-in-depth: `stateReported === true` is the real discriminator and excludes every scraped-led case, including a live trust dialog (reconcile returns reported:false when scraped.evidence is present); `!== ASKING_GENERIC` is documented belt-and-suspenders (iterations 1, 2, 3).
- `question = paneQuestion || reportedQuestion` gives the live pane strict precedence; `options` gated on `!question.reported` so reported prose never draws numbered buttons (iterations 1, 2, 3).
- Question text rendered via textContent on both surfaces, so an agent-authored `because` cannot inject markup (iteration 2).
- Test hygiene: clearReport in both withThread and withAgent finally blocks stops self-report leakage; every new test carries a control read via /api/status whose arms can fail (iterations 2, 3).
