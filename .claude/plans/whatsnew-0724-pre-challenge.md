---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0724
diff_hash: e14877fc7ad37fc7bcb62e2ae1e66dd21ae93e1fa1a4bbd2e126815b1f402c5d
validation: passed
subdir_audit: passed
timestamp: 2026-10-05T22:31:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 3, Opus: NITs only; iteration 4 reviewed Mona Lisa's copy edit, NIT only)
**Total findings:** 3 WARNINGs, 0 BLOCKERs, 0 CONVENTIONs, 7 NITs
**Fixed:** 3 | **Deferred:** 0 | **Asked:** 0

### Validation (what "passed" rests on; stated in full because it is not a Mortals run on this hash)
- A copy-only change to web/whats-new.json (plus this plan) on 49587aa6a, a tree that passed the full suite and the full
  browser gate in the 0.7.23 cut (16:03, release.sh exit 0, 15523 tests).
- `tools/whats-new-check.js 0.7.24` passes for mac and windows (5 highlights each).
- The #1720 browser-check gate is satisfied by the `Browser-check:` trailer on each commit (copy-only).
- The 0.7.24 cut's step 3+3b runs the full suite and page layer on this exact tree (frozen at the pin plus the version
  bump) and aborts before anything is published on any red. Per Splinter's 17:20 priority ruling, that is the gate for
  this change, not a separate Mortals queue run.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] web/whats-new.json:7 — "With Kosmos+, the Agents view now also lists..." is true only on a page served from this computer's Kosmos+ https address (oaEligible); read in the local window, the person finds nothing --> FIXED (905b3b8b4)
- [WARNING] web/whats-new.json:12 — "each Claude agent" undersells: engine/receipt.js gives Codex and Gemini CLI agents a full receipt; the plan's rationale was wrong --> FIXED (905b3b8b4, line and plan)
- [NIT] web/whats-new.json:12 — the receipt covers what an agent did while it held the task --> FIXED ("while they held it")
- [NIT] plan:9 — cited the proof-file commit for #4812 --> FIXED (453605299)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (line 1, rewritten in iteration 1)
- [WARNING] web/whats-new.json:7 — a computer's agents show only once it lets this browser in (oaClassify 'notin': "not let in on X yet") --> FIXED (28c14a40d, line and title)
- [NIT] plan:23 — "plus this one commit" stale after the review commits --> FIXED (28c14a40d)
- [NIT] web/whats-new.json:12 — Grok/Antigravity/Muse show "not available"; "its agents" covers that
- [NIT] engine/receipt.js:19 — its header says Claude only (not in this diff)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** — no new actionable findings.
- [NIT] web/whats-new.json:6 — a computer on a Kosmos older than 0.7.21 shows "It may need the latest Kosmos" (the page explains it)
- [NIT] web/whats-new.json:11 — a file changed by a command counts as a command, not a file
- [NIT] plan — the Token Usage line names providers, not keys; no change needed

#### Iteration 4 (after the merge of PR #5348: Mona Lisa's copy check, commit 8adf1f849)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [NIT] web/whats-new.json:12 — "while they worked on it" paraphrases the receipt's "while it held this task"; acceptable plain language (kept, per Mona: "held" is our word for a claim)
- [STRENGTH] "by day, model and agent" is literal: Usage history (day, model), the per-model table, and By agent all take the #5158 providers

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/whats-new.json:7 | BRANCH | Agents line true only on the Kosmos+ address | FIXED | 905b3b8b4 |
| 2 | 1 | WARNING | web/whats-new.json:12 | BRANCH | receipt is not Claude-only | FIXED | 905b3b8b4 |
| 3 | 2 | WARNING | web/whats-new.json:7 | SELF | agents show only on computers that let you in | FIXED | 28c14a40d |

### NITs (non-blocking)
- web/whats-new.json:6 — pre-0.7.21 computers show "may need the latest Kosmos" (iteration 3)
- web/whats-new.json:11 — command-made changes count as commands (iteration 3)
- engine/receipt.js:19 — header says Claude only, outside this diff (iteration 2)

### Strengths
- No line mentions an API key or implies one is needed (all iterations)
- Every line checked against the code at 49587aa6a, the tree that ships (all iterations)
- The merge-commit reasoning for keeping the pin an ancestor of main is correct (iteration 1)
