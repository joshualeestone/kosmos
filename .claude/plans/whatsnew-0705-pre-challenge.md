---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0705
diff_hash: d3feaebca5ec1e044c0269df9a742433bd46a2b10603b19038c416706b5731da
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T18:18:11Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (round 3 returned only NITs)
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 6 NITs
**Fixed:** 3 | **Deferred:** 2 | **Asked (awaiting user):** 0

Validation on 958052780 (hash d3feaebca5ec): 10946 tests, 0 failed; the browser-check gate was overridden by the
Browser-check trailer (release-notes data, not markup); bc-surface-map 0 FAILED. tools/whats-new-check.js 0.7.05 passes.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [CONVENTION] commit 987155ba5 -- the subject is not `<branch> -- <message>` --> DEFERRED: the same style as both earlier What's New commits (ff372369f, 00e4afa18); a squash merge lands the PR title, which follows the convention
- [NIT] shield icon for an offline message (fixed in iteration 2 by the rewrite: now spark)
- [NIT] plan filename has no timestamp (the whole whatsnew-* family has none)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 3 (all in this branch's own highlight text)
- [WARNING] web/whats-new.json:6 -- the refused-check line described a hover tooltip only; the visible pill is unchanged --> FIXED (958052780): dropped, four highlights
- [WARNING] web/whats-new.json:3 -- "Mac asleep" was stronger than the product's hedge and ignored that it needs an open board through Kosmos Plus --> FIXED (958052780)
- [WARNING] web/whats-new.json:4 -- the offline line left out Kosmos Plus, and its "before" contrast was wrong for 0.7.03 --> FIXED (958052780): the contrast is the 0.7.03 wording, "Kosmos is not answering"
- [CONVENTION] web/whats-new.json:5 -- "import" is not the product's word ("Upload an org chart", "Create the team"; Import is a different option) --> FIXED (958052780)
- [NIT] "easy to tap" overstated a 44px to 48px change --> FIXED (958052780): "a little taller"
- [NIT] shield icon --> FIXED (958052780): spark
- [NIT] the weakest premise is wider (a Mac that skips 0.7.03 never sees its lines) --> FIXED (958052780): stated in the plan

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings.
- [NIT] spark vs phone icons for the two Kosmos Plus lines
- [NIT] plan filename timestamp (duplicate of iteration 1)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | commit 987155ba5 | BRANCH | Commit subject style | DEFERRED | precedent; squash lands the PR title |
| 2 | 2 | WARNING | web/whats-new.json:6 | SELF | Tooltip-only claim | FIXED | 958052780 |
| 3 | 2 | WARNING | web/whats-new.json:3 | SELF | Mac-asleep overclaim | FIXED | 958052780 |
| 4 | 2 | WARNING | web/whats-new.json:4 | SELF | Offline scope and contrast | FIXED | 958052780 |
| 5 | 2 | CONVENTION | web/whats-new.json:5 | SELF | Not the product's word | FIXED | 958052780 |

Origin note: set by reading which commit wrote the cited line, not by the scripted blame lookup.

### NITs (non-blocking, across all iterations)
- plan filename has no timestamp (whole family)
- icon choice for the two Kosmos Plus lines

### Strengths (across all iterations)
- Every highlight is checked by content: its text is absent at the 0.7.03 freeze and present on main (all rounds)
- Nothing user-visible since the freeze is missing without a stated reason (all rounds)
- The What's New window opens for a 0.7.03 user updating to 0.7.05; nothing in the version or format blocks it (round 2)
