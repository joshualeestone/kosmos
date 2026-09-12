---
pre_challenge: true
method: challenge-loop
branch: richtext-instructions-2909
diff_hash: 0ad40f50343d2c02b3093e547ef32efd84979d41d61a1283f5090e34d2dfda7e
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T16:39:50Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 returned zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 2 WARNINGs, 2 CONVENTIONs, 7 NITs (0 BLOCKERs)
**Fixed:** 5 (2 WARNINGs, 2 CONVENTIONs, 1 NIT acted on for precision) | **Deferred:** 6 NITs (recorded, non-blocking) | **Asked:** 0

The loop ran on the accuracy axis this change is about: whether the instruction
text handed to every agent truthfully describes what the Kosmos room/dialogue
renderers actually render. Findings shrank monotonically (WARNING/CONVENTION,
then only NITs), which is the expected diminishing-returns curve. Reviewer model
was alternated per iteration (opus, sonnet, opus, sonnet) so convergence is
witnessed by more than one model.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty; nothing committed yet)
- [NIT] engine/defaults.js — "a bare web address becomes a link" is looser than the renderer, which requires an http(s):// scheme --> FIXED (commit af815b7e): tightened to "a web address that starts with http:// or https://"
- [NIT] engine/defaults.js — the `>` caveat under-claims for dialogues (defensible lowest-common-denominator) --> noted, later addressed in iter 2
- [NIT] — the pinned fingerprint could not be executed inside the read-only review --> non-issue: verified by the orchestrator's own `node --test` run

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 0 NITs
**Self-generated:** 0 of the above (both cited lines were in the base feature commit 9c92cbf8, not a loop-fix commit)
- [WARNING] engine/defaults.js — the section framed rooms and dialogues as "alike" but never said a `>` quote renders in a dialogue while staying literal in a room --> FIXED (commit 64248f95): the `>` caveat now states the asymmetry, pinned in the content test
- [CONVENTION] .claude/plans/... — plan said "reviewer joshualeestone"; this repo's CLAUDE.md forbids a human reviewer on a Kosmos PR --> FIXED (commit 64248f95): corrected to no-human-reviewer per repo convention

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above (label caveat text originated in the base feature commit)
- [WARNING] engine/defaults.js:249 — the `[label](address)` drop lives in pjRichSpans (shared by pjProse AND pjRich), so it drops the address in a dialogue too; the caveat's "in a room" falsely implied dialogues differ --> FIXED (commit 3e0ad1d2): now "in both a room and a dialogue"
- [CONVENTION] .claude/plans/... — plan filename lacked the `-<timestamp>` suffix the repo convention specifies --> FIXED (commit 3e0ad1d2): renamed to richtext-instructions-2909-20260912T1631.md
- [NIT] engine/defaults.js — "headings written with #" omits that the renderer needs a space after the hashes --> DEFERRED: standard-markdown behavior, agents know it

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings. The three NITs (a stale line-number citation in the plan's forensic note, an uneven source word-wrap on one array line, and "one-to-one" vs "direct dialogue" phrasing) are cosmetic/forensic and do not change what an agent reads; recorded below rather than chased.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | engine/defaults.js | BRANCH | "bare web address" looser than the http(s):// autolink | FIXED | af815b7e |
| 2 | 2 | WARNING | engine/defaults.js | BRANCH | `>` room-vs-dialogue asymmetry not stated | FIXED | 64248f95 |
| 3 | 2 | CONVENTION | .claude/plans | BRANCH | plan named a human reviewer; repo forbids it | FIXED | 64248f95 |
| 4 | 3 | WARNING | engine/defaults.js:249 | BRANCH | `[label](url)` drop scoped "in a room" but is shared | FIXED | 3e0ad1d2 |
| 5 | 3 | CONVENTION | .claude/plans | BRANCH | plan filename lacked the `-<timestamp>` suffix | FIXED | 3e0ad1d2 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] engine/defaults.js — heading needs a space after `#` (standard markdown; not spelled out) (iteration 3)
- [NIT] .claude/plans/...-20260912T1631.md — cites web/index.html:37456 for the stale "room has no inline markdown" comment; the comment is on origin/main at ~37487. Substantive claim (comment predates #2239 and is stale) is correct; the line number drifted. (iteration 4)
- [NIT] engine/defaults.js — the array line `'Anything written as raw'` is a short orphaned line, uneven with the surrounding word-wrap (renders fine once joined). (iteration 4)
- [NIT] engine/defaults.js — "one-to-one" used once as a stand-in for "direct dialogue"; mild terminology inconsistency, reads fine in context. (iteration 4)

### Strengths (across all iterations)
- Every factual claim about the renderer's supported subset was independently verified against pjProse/pjRichSpans/pjBody/pjRich on origin/main and is accurate, including the one real room-vs-dialogue asymmetry (`>`). (iterations 1-4)
- Delivered as a NEW `### ` heading, so missingFrom()/#539's refresh reaches the EXISTING fleet, which is exactly what Josh's "almost all of the agents I've talked to" requires; proven by a delivery test with a discriminating control. (iterations 1-4)
- Doctrine ceremony intact: DOCTRINE_VERSION 9->10, version-log entry with a named weakest premise, fingerprint pinned; no em/en dashes, and the no-em-dash test covers the new content. (iterations 1-4)
- Scope disciplined: only defaults.js/its test/the plan touched; the CLI --stdin path and capabilities endpoint deferred with stated reasons per "recommend, implement, continue." (iteration 4)
