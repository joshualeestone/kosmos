---
pre_challenge: true
method: challenge-loop
branch: usageagy-5158
diff_hash: 39f97301c86e66d4ff4e49ff74a53dfb9186d9bb1ace00b9f5d41db06bd26ff7
validation: passed (full suite tools/run-tests.sh at b950037f5, 14724 pass 0 fail, REAL_EXIT=0, clean tree before and after, 2026-10-03 16:01 CDT; rebased on main after #5163 merged (c11ea424c); focused usage tests + guards green on the new base)
subdir_audit: passed
timestamp: 2026-10-04T21:06:09Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, opus, sonnet; each a fresh blind reviewer)
**Converged:** Yes (iteration 4 found no BLOCKER or WARNING)
**Fixed:** 7 WARNINGs + NITs as listed in .claude/plans/usageagy-5158.md | **Deferred:** 0 | **Asked (awaiting user):** 0

Antigravity token usage beside Claude, Codex, Gemini CLI and Grok (#5158 slice 3, stacked on slice 1). Each model call is
dated by its step and placed by the conversation's workspace; measured on copies of 25 real conversations (109 calls),
totals equal an independent decode exactly. Ship in the same release as slice 1.

## Iteration 1 (opus): 3 WARNINGs, fixed
- [WARNING] Opening a WAL db leaves an empty -wal read as a write (skip + fallback day moved): stats before open, empty -wal ignored, creation-day fallback.
- [WARNING] Any steps/folder read error treated as "no table": only "no such table" is absent; one snapshot.
- [WARNING] Every request decoded every call: per-file cache.
## Iteration 2 (sonnet): 2 WARNINGs, fixed
- [WARNING] Cache cursor blind to late lower calls, rewinds, step edits: idx+size listing, newest re-decoded, removed calls dropped, steps never cached.
- [WARNING] A call before its step frozen on the fallback day: undated call in a fresh conversation keeps the scan unfrozen; zero-token calls skipped.
## Iteration 3 (opus): 2 WARNINGs, fixed
- [WARNING] Busy conversation judged stale by the db mtime: freshness takes the -wal.
- [WARNING] Steps-error test could pass with the error swallowed: asserts nothing was filed.
## Iteration 4 (sonnet): CLEAN
- [NIT] Untested safe-direction branches; a late folder URI; one scan's display dip on a failed open. Not taken (recorded in the plan).
