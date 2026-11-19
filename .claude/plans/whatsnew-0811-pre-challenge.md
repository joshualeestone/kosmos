---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0811
diff_hash: 80c1edc9fc3409a67bd248b7533a91947d595ce4767c486a95e55c22e1ca0c50
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T16:54:03Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 5 (1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 3 NITs)
**Fixed:** 3 (the BLOCKER, the WARNING, and one NIT taken) | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: the full suite on Mortals (mortals-validate.sh) for HEAD 640dfdb097, entry `"status":"clean"` (a real run, not a reused skip), hash 80c1edc9fc34 equal to this proof's diff_hash, base 51c966ef14. Node suite: 29,869 tests, 0 failed, 0 cancelled. Shell shards 1/4 to 4/4: 83, 75, 78 and 80 passed. The What's New checker (`tools/whats-new-check.js 0.8.11`) passed for mac and windows after each change (mac 5, windows 4). No subdir CLAUDE.md is in the diff.

Order note: this is a data-only branch whose full validation is a Mortals queue turn, so the blind reviews ran first and the full validation ran once, as the final gate (6j), on the exact HEAD this PR carries. Nothing changed between the last review and that run.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (no loop fix commit existed yet)
- [BLOCKER] release/whats-new-pool.json (the #8719 entry) and web/whats-new.json: the line quoted "Not started by Kosmos", a label the board does not show; the shipped tile and list label is "Not linked to Kosmos" (web/index.html, 1 hit; the old words 0 hits in web/index.html) --> FIXED (640dfdb097)
- [WARNING] release/whats-new-pool.json (the #8719 title and line): said where the window came from, while the product only says Kosmos "cannot confirm it started" it --> FIXED (640dfdb097): title "A window Kosmos cannot confirm says so", line in the board's own words
- [NIT] the phone line read as a guarantee; the notice depends on the person's switch --> taken: "can get" in the line and "can reach" in the title (640dfdb097)
- [NIT] .claude/plans/whatsnew-0811.md: empty Review log heading --> filled (640dfdb097)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** the #8719 line now uses the real label and wording (the reviewer checked web/index.html)
- [NIT] web/whats-new.json: the phone line does not mention federated rooms or posts naming an agent; judged rare by the reviewer, no change
- [NIT] release/whats-new-pool.json (the star line): "sparks" called an embellishment; not changed, because #8705's own plan says the burst is "a pop and six gold sparks"
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | release/whats-new-pool.json (#8719 entry) | BRANCH | Quoted a board label that does not exist | FIXED | 640dfdb097 |
| 2 | 1 | WARNING | release/whats-new-pool.json (#8719 entry) | BRANCH | Claimed where the window came from; product says only "cannot confirm" | FIXED | 640dfdb097 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] the phone line as a guarantee (iteration 1): taken, "can get"
- [NIT] empty Review log heading (iteration 1): filled
- [NIT] the phone line leaves out federated rooms and agent-named posts (iteration 2): not changed
- [NIT] "sparks" in the star line (iteration 2): not changed, matches #8705's plan

### Strengths (across all iterations)
- The 0.8.10 "mark shown" bookkeeping is its own commit, read from history at the 0.8.10 freeze (iteration 1)
- Every merge since the 0.8.10 pin is either given a line or listed under No line with a reason; #8700's exclusion checked against `data-fed-ui="show"` (iteration 1)
- The #5167 line matches the Swift change and is correctly mac-only; the checker shows mac 5, windows 4 (iteration 2)
- The three notes-only entries carry notesOnly and ranks of 131 or more, so they stay out of the window (iteration 2)
