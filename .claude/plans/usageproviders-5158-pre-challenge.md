---
pre_challenge: true
method: challenge-loop
branch: usageproviders-5158
diff_hash: c41cc6f9f4b211561f7076be3943393b7027aab0bf1592e9e60dfa9cfa35f99c
validation: passed (Mortals full suite at 49da8f447, 2026-10-03 12:02 CDT, hash c41cc6f9f4b2)
subdir_audit: passed
timestamp: 2026-10-03T17:02:57Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, sonnet, sonnet; each a fresh blind reviewer)
**Converged:** Yes (iterations 3 and 4 found no BLOCKER or WARNING)
**Total findings:** 9 WARNINGs (iteration 1: 5, iteration 2: 4), all FIXED; NITs as listed
**Fixed:** 9 WARNINGs + 13 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Codex, Gemini CLI and Grok token usage beside Claude's in Token Usage, counted once each, frozen per past day in its
own `<day>.providers.v1.json`. Claude's saved days (`<day>.v2.json`, `<day>.folders.v1.json`) are never rewritten
(operator constraint), guarded by an end-to-end test whose mutant fails it.

## Iteration 1 (opus)
- [STRENGTH] Claude's freeze writes finish before the merge runs; no path rewrites Claude's files.
- [WARNING] A failed or partial scan would be frozen as the truth. FIXED: `complete` flag; freeze only complete scans.
- [WARNING] No test covered the order Claude's history depends on. FIXED: end-to-end test + mutant.
- [WARNING] A forked Codex rollout replays the parent's totals. FIXED: first total is a baseline.
- [WARNING] Homes from list() drop signed-out and forgotten accounts. FIXED: homes by folder name, deduped by real path.
- [WARNING] Every request read every session file. FIXED: files untouched since the first wanted day are skipped.
- [NIT] x7 taken (turn-number fallback, comments, server test env, archived_sessions); 1 not taken (Gemini slug with
  no .project_root).

## Iteration 2 (sonnet)
- [WARNING] A fork can replay several totals. FIXED: every total stamped before the fork is a baseline; test + mutant.
- [WARNING] A rollout in both sessions and archived_sessions counted twice. FIXED: read once by file name.
- [WARNING] A permanently broken file kept every day unfrozen. FIXED: blocks freezing only while fresh (10 min).
- [WARNING] The unreadable-file test depended on file permissions. FIXED: a half-written Grok file, fresh and aged.
- [NIT] x3 taken (stat and home-listing errors mark incomplete; comment; test name).

## Iteration 3 (sonnet): CLEAN
- [NIT] x4 taken (seen-after-read; `<=` fork time; Gemini project-root errors; link test skip); 2 not taken (line-level
  JSON errors only touch today; an unmounted home reads as empty).

## Iteration 4 (sonnet): CLEAN
- [NIT] Comment wording ("at or before"). FIXED.

## Final Ledger
| Iteration | Blockers | Warnings | Fixed |
|---|---|---|---|
| 1 | 0 | 5 | 5 + 7 NIT |
| 2 | 0 | 4 | 4 + 3 NIT |
| 3 | 0 | 0 | 4 NIT |
| 4 | 0 | 0 | 1 NIT |
