---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0708
diff_hash: 0bb5ff1122fe5af4da6270b43670f54b99e6c4e05306f0d63be701250a314723
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T08:49:27Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 3 (0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 10 NITs)
**Fixed:** 2 | **Deferred:** 1 | **Asked (awaiting user):** 0

Baseline validation (6.0) was started at 59061089d and stopped by me after iteration 1's findings, because
the fixes would change the file it was validating; the full validation then ran green on 5c633c3ff
(hash 0bb5ff1122fe), and 6j skipped on that same clean hash.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] web/whats-new.json:4 - "Every agent's model ... real name" overclaimed #4500 (Muse still shows the provider, its stated limit) --> FIXED (5c633c3ff): names Gemini, Grok and OpenAI
- [WARNING] web/whats-new.json:5 - "changes its name everywhere on its page straight away" overclaimed #4437 (#4423 lists places that keep the old name; it lands on the next refresh) --> FIXED (5c633c3ff): "across its page: the title, its messages and the working line"
- [NIT] web/whats-new.json:3 - webhook task "for a person" read as assigned --> FIXED (5c633c3ff): "waits for you to hand out"
- [NIT] web/whats-new.json:6 - the swarm icon is the Agent Swarms mark --> FIXED (5c633c3ff): chat
- [NIT] .claude/plans/whatsnew-0708.md:1 - plan name has no timestamp (whatsnew-0705/0707 are the same shape)
- [NIT] branch behind origin/main --> rebased (c76878c16 base)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION (duplicate of a deferred item), 6 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 0
- [CONVENTION] .claude/plans/whatsnew-0708.md:1 - plan name has no timestamp --> DEFERRED (recorded in the plan in iteration 1; same as whatsnew-0705 and whatsnew-0707; the gate finds the plan by branch)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/whats-new.json:4 | BRANCH | Model-name tile overclaimed #4500 (Muse) | FIXED | 5c633c3ff |
| 2 | 1 | WARNING | web/whats-new.json:5 | BRANCH | Rename tile overclaimed #4437 (#4423 open) | FIXED | 5c633c3ff |
| 3 | 2 | CONVENTION | .claude/plans/whatsnew-0708.md:1 | BRANCH | Plan name has no timestamp | DEFERRED | Same shape as whatsnew-0705/0707; gate finds it by branch |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] web/whats-new.json:3 - webhook wording (iteration 1, fixed)
- [NIT] web/whats-new.json:6 - swarm icon (iteration 1, fixed)
- [NIT] branch behind main (iteration 1, rebased)
- [NIT] web/whats-new.json:3 - the link works from this computer unless Kosmos+ gives an internet link (#4501); the reveal explains it (iteration 2)
- [NIT] plan says "the product's own hint" but paraphrases it ("give them to someone") (iteration 2)
- [NIT] web/whats-new.json:5 - "across its page" is scoped by the list after the colon; #4423 still open (iteration 2)
- [NIT] web/whats-new.json:6 - the title "Steadier with many agents" is broader than delivery; the plan names this as its weakest premise (iteration 2)
- [NIT] web/whats-new.json:5-6 - two chat icons side by side (iteration 2)
- [NIT] first commit message says "whole agent page" (history only) (iteration 2)

### Strengths (across all iterations)
- The file fits the window exactly: 5 highlights, icons from ICONS, titles 16 to 33 characters, lines 75 to 112, no em dash in any spelling (iterations 1 and 2)
- Nothing breaks while the app is still 0.7.07: another version's file is the ordinary between-cuts state, and no test pins the committed file to package.json (iterations 1 and 2)
- Every cited PR is merged, is an ancestor of HEAD, and is new since the 0.7.07 bump; each tile respects its PR's stated limits (iteration 2)
- The plan drops the stale Sonnet 5.5 tile and does not pre-announce #4466, which may miss the cut (iterations 1 and 2)
