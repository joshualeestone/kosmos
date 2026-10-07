---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0727
diff_hash: bfa5a855b893beaaef8b050475f762f1f87561d49eab22de3a7449bad7a24b3d
validation: partial (data-only change to web/whats-new.json plus the plan. Run alone at c29ceeefe: tools/whats-new-check.js 0.7.27 passes (mac 5, windows 4); engine/whatsnew.test.js + tools.whats-new-check-3955.test.js 21/21; the #1720 browser-check gate passes on the Browser-check trailer in the first commit and the #2518 surface gate passes. No full-suite run: Mortals is queued with three other branches, and the 03:00 cut's step 3 runs the full suite at the pin, which is this merge, as for 0.7.26)
subdir_audit: passed
timestamp: 2026-10-07T04:11:23Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (plus Mona Lisa's copy check on every line, twice tonight)
**Converged:** Yes
**Total findings:** 17 (0 BLOCKERs, 7 WARNINGs, 1 CONVENTION, 9 NITs)
**Fixed:** 6 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
- [WARNING] web/whats-new.json - the top bar line said "board layouts", not a name the product uses --> FIXED (378c912ff)
- [WARNING] web/whats-new.json - Codex isolation reaches existing agents only at their next start --> FIXED (378c912ff, "From their next start")

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
- [WARNING] web/whats-new.json - the top bar line should name the View control's own options --> FIXED (18a757939, "Separate tabs" and "One screen")

#### Iteration 3
**Reviewer model:** opus (after the top-up to five lines: Pause #5395, model picker #5433, the latter narrowed to "Claude or OpenAI" because Gemini, Grok and Antigravity offer no model choice)
**New findings:** 0 (all five lines checked against their PRs)
**Self-generated:** 0
Not counted as convergence: this pass used a narrower prompt than the template, so the loop continued with templated passes.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] .claude/plans/whatsnew-0727.md - the plan listed three lines and "if they land" for two merged PRs --> FIXED (33362bc41)
- [CONVENTION] Browser-check trailer only on the first commit --> DEFERRED: the gate reads base..HEAD and one trailer covers the branch; run alone, it passes
- [NIT] plan "MAC only" spelling; Codex claim reasoned from the PR, not measured

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/whats-new.json - the Codex line sold a trade-off (desktop config such as an MCP server also stops reaching agents) as only a gain --> FIXED (c29ceeefe, "the plugins and settings of your own Codex app no longer reach them"; Mona approved)
- [NIT] Pause button is on the project's page, not beside the name in the list --> FIXED (c29ceeefe; Mona approved)
- [NIT] "Move a project's folder" title --> no change (the line says the person moved it)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/whats-new.json - the top bar line matters to few readers --> DEFERRED: the line scopes itself ("On a computer that always shows scrollbars"); a platform tag cannot express it (a Mac set to always show scrollbars is affected); Mona approved it
- [WARNING] web/whats-new.json - the model line omits OpenAI's per-account list and the "Let OpenAI choose" default --> DEFERRED: the reviewer marked it "no change required"; a one-line summary is not the settings page
- [NIT] "plugins and settings" could read as the agents' own settings; plan cells dense

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] "Separate tabs" / "One screen" are tooltip names on icon buttons
- [NIT] the Pause button is hidden on archived projects
- [NIT] the plan could record that switching to Claude now pins Claude Sonnet 5 by default (PR #5433's own weakest premise)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/whats-new.json | BRANCH | "board layouts" is not the product's name | FIXED | 378c912ff |
| 2 | 1 | WARNING | web/whats-new.json | BRANCH | Codex isolation from next start | FIXED | 378c912ff |
| 3 | 2 | WARNING | web/whats-new.json | BRANCH | name the View options | FIXED | 18a757939 |
| 4 | 4 | WARNING | .claude/plans/whatsnew-0727.md | BRANCH | plan out of date with the five lines | FIXED | 33362bc41 |
| 5 | 4 | CONVENTION | commits | BRANCH | trailer only on first commit | DEFERRED | gate covers the range, passes alone |
| 6 | 5 | WARNING | web/whats-new.json | BRANCH | Codex trade-off stated as gain | FIXED | c29ceeefe |
| 7 | 6 | WARNING | web/whats-new.json | BRANCH | top bar line relevance | DEFERRED | self-scoped, not taggable, approved |
| 8 | 6 | WARNING | web/whats-new.json | BRANCH | model line omits OpenAI detail | DEFERRED | summary line, reviewer: no change |

### NITs (non-blocking, across all iterations)
- Pause location (iteration 5, fixed); folder title (5); "MAC only" spelling (4); Codex claim reasoned not measured (4); "plugins and settings" reading (6); dense plan cells (6); tooltip names (7); archived projects hide Pause (7); Sonnet 5 default not in plan (7)

### Strengths (across all iterations)
- Every line traced to its merged PR; the model line narrowed to the providers that actually offer a choice
- Mac-only tag on the Codex line verified against the Windows Codex path, which PR #4605 did not touch
- Checker, tests and both browser-check gates pass; no em dash in any spelling; all lines at most 136 characters
