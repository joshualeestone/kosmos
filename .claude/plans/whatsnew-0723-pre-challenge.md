---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0723
diff_hash: 2b2fc424c0ecb179687ab1470bef91dd1e68747a96b97cf738bd60d3729760da
validation: passed
subdir_audit: passed
timestamp: 2026-10-05T17:10:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4, Sonnet: no new actionable findings)
**Total findings:** recorded per iteration in .claude/plans/whatsnew-0723.md (the loop ran in an earlier session; this proof is written from that record)
**Fixed:** every BLOCKER and WARNING from iterations 1 to 3 | **Deferred:** 1 (iteration 4's OpenAI-key concern, with evidence) | **Asked:** 0

### Validation (how "passed" is established for this hash)
- Mortals full validation ran on this exact tree (tree 94d8b73f78041da1b35c6615bb3a2c855cb0f8b2, diff hash 2b2fc424):
  15292 tests, 0 fail, 0 cancelled. Its one red was the #1720 browser-check gate (a web/ change with no assertion),
  which reads commit messages, not the tree.
- 0afe77984 adds only the gate's documented `Browser-check:` trailer (empty commit; tree unchanged, hash unchanged).
- Both commit-reading gates run alone at 0afe77984: #1720 browser-check gate PASS (control at a435e052f: FAIL);
  #2518 surface gate PASS.
- Per Splinter's 12:06 ruling (~/.cache/claude-handoffs/splinter-baron-0723-1205.md), tree-identical evidence stands
  in for a full re-run. The full browser gate runs on this tree at the cut's step 3b.
- Merge onto current main: merge-tree clean; main's 57 newer commits touch neither web/whats-new.json nor
  tools/whats-new-check.js.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**Self-generated:** 0
- [BLOCKER] web/whats-new.json — org chart line said Gemini and Grok read PDFs; Gemini is off for org charts (ENABLED_DEFAULT google:false) and Grok reads PNG/JPG only --> FIXED (line rewritten against engine/orgchartkeys.js)

#### Iteration 2
**Reviewer model:** sonnet
**Self-generated:** 1 (the rewritten org chart line)
- [WARNING] web/whats-new.json — key readers are a fallback (currentReader uses Claude whenever it can run) --> FIXED ("Without Claude set up")

#### Iteration 3
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] web/whats-new.json — a Grok subscription does not read org charts (accountsFrom keeps apikey only) --> FIXED ("Grok API key")
- [WARNING] web/whats-new.json — key-account title should say what the line shows --> FIXED
- [WARNING] Token Usage line on Windows not run on a Windows box --> DEFERRED: the scans use os.homedir() with no platform branch; reasoned true, recorded in the plan as accepted and not measured

#### Iteration 4
**Reviewer model:** sonnet
**Self-generated:** 0
**Converged** — no new actionable findings.
- [WARNING] OpenAI key accounts not covered by the key-account line --> DEFERRED with evidence: #5280 (462eb8be0) hands /api/status only the Claude, Gemini and Grok account lists (server.js: "OpenAI's list is left out on purpose")
- [NIT] "last characters" could say "last four"

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/whats-new.json | BRANCH | org chart line claimed Gemini/Grok PDFs | FIXED | iteration 1 commit |
| 2 | 2 | WARNING | web/whats-new.json | SELF | key readers are a fallback | FIXED | 646492067 |
| 3 | 3 | WARNING | web/whats-new.json | BRANCH | Grok subscription does not read org charts | FIXED | b5595ee2b |
| 4 | 3 | WARNING | web/whats-new.json | BRANCH | key-account title | FIXED | b5595ee2b |
| 5 | 3 | WARNING | web/whats-new.json | BRANCH | Token Usage on Windows unmeasured | DEFERRED | reasoned: no platform branch |
| 6 | 4 | WARNING | web/whats-new.json | BRANCH | OpenAI key accounts | DEFERRED | #5280 excludes OpenAI's list by design |

### NITs
- [NIT] web/whats-new.json — "last characters" could say "last four" (iteration 4)

### Strengths
- Every line checked against the engine file that decides it, not the PR title (iterations 2 to 4)
- tools/whats-new-check.js 0.7.23 passes for mac and windows; no platform words, so both platforms show all five
