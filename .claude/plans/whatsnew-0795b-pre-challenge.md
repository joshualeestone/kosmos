---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0795b
diff_hash: 42df83f672f0b82bf1f481ab42db92b20476443d61a2744030feef159c22802f
validation: passed
subdir_audit: passed
timestamp: 2026-11-07T00:30:06Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs)
**Fixed:** 1 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full suite on Mortals for this exact diff hash (42df83f672f0), base 5c7ec5ec46: tests 27660, pass 27217,
fail 0, cancelled 0, entry status clean (2026-11-07T00:29:53Z). An earlier Mortals run on the same tree went red on 1
test, the #1720 browser-check gate (web/ changed, no Browser-check trailer); the trailer was added to the commit
messages (tree unchanged), the gate run alone then passed, and the full run above is after that fix.
Subdir CLAUDE.md audit: rc 0 (no CLAUDE.md in the diff).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] release/whats-new-pool.json (crash recovery item) and web/whats-new.json:19 - the Windows-only highlight "Settings says when crash recovery is not set up" was in the 0.7.93 and 0.7.94 windows and would show a third time; the tool's header says a Windows-only item is retired by hand once Windows prod has shown it --> FIXED (commit c6e7d0f383): Windows prod serves 0.7.93 (live latest-win.json), whose build e9f745d813 showed it, so status shown, shownIn 0.7.93, build run again
- [NIT] .claude/plans/whatsnew-0795b.md:7 and the first commit message - said 0.7.94 showed four highlights; it showed five, and the tool marked four --> fixed in the plan (same commit)
- [NIT] web/whats-new.json - Linux sees only two highlights; follows the tool's per-platform rule

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (the crash recovery retirement, checked against latest-win.json and e9f745d813)
- [NIT] release/whats-new-pool.json:~1133 - the retirement is a statement about Windows 0.7.93 and would be wrong only if Windows were rolled back
- [NIT] web/whats-new.json - the Gemini and old project summaries copy was not re-verified against code here; unchanged text, reviewed in its own PRs
- [NIT] .claude/plans/whatsnew-0795b.md - "Windows prod serves 0.7.93" is a point-in-time claim
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json:1136 | BRANCH | Windows-only crash recovery item would show a third time | FIXED | c6e7d0f383 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] plan and first commit said four highlights for 0.7.94, it was five (iteration 1, fixed in the plan)
- [NIT] Linux window has two highlights (iteration 1)
- [NIT] the Windows retirement assumes no Windows rollback (iteration 2)
- [NIT] Gemini and old project summaries copy not re-verified here (iteration 2)
- [NIT] "Windows prod serves 0.7.93" is point-in-time (iteration 2)

### Strengths (across all iterations)
- web/whats-new.json is exactly the tool's choose(pool, 5) over the committed pool; both reviewers replayed it (iterations 1 and 2)
- The four items marked shownIn 0.7.94 are exactly the non-Windows titles of the 0.7.94 build 90b6f28468 (iteration 1)
- prod-check exits 0 after the build; it refused before (iterations 1 and 2)
- No item text added or reworded; no em dashes; the one hand edit is named in the plan with the rule it follows (iteration 2)
