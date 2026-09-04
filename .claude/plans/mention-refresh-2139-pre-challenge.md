---
pre_challenge: true
method: challenge-loop
branch: mention-refresh-2139
diff_hash: 0098f1140895fa45d04440166279c196b219ffb7c401a63fe8e2ec6960680331
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T18:46:44Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (1 initial-validation baseline + 3 fresh, blind review passes)

**Plan-file + hash note:** the plan file `.claude/plans/mention-refresh-2139.md` was missing at first
(the gate refused PR creation for it), so it was added and a 3rd blind pass run on the plan-added
tree; that pass surfaced one NIT (a comment claimed loadProjects "returns false" on a read error when
it returns true there — corrected to state only the true, load-bearing property: it swallows its read
errors in an internal try/catch and never rethrows). This proof's `diff_hash` covers the plan file and
the comment fix. A clean validation window was hard to catch on the shared Mac (a release cut held the
machine, then concurrent browser-check runs tripped the cut/browser-run guards); every red was
confirmed contention (the guard tests pass alone), and the final validation ran clean.
**Converged:** Yes (the 2nd review pass surfaced zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Fixed:** 1 WARNING + (test tightened) | **Deferred:** 3 NITs | **Asked:** 0

kosmos#2139: the @mention autocomplete picker showed an agent's OLD name after a
rename. Root cause: the picker candidates come from PROJECTS[].agents[].name
(mentionCandidates -> pjById(PJ_CURRENT).agents), and PROJECTS is repopulated only
by loadProjects() (reads /api/projects); the #d-save agent-detail Save handler
refreshed the fleet via tick() but not PROJECTS. Fix: after a successful Save whose
shown name changed, call loadProjects() (non-blocking; it self-catches read errors
and its auto-open side effects are one-time-flag-guarded). Guarded by a static
source-pin (the About-you-gate pattern, since the live picker drive is not in
`node --test`). Each blind agent diffed against origin/main.

### Per-Iteration Breakdown

#### Iteration 1 — initial validation baseline (6.0)
Full run-tests.sh + subdir-CLAUDE.md audit both green on the committed branch.

#### Iteration 2 — review pass 1
**New findings:** 1 WARNING, 1 NIT
- [WARNING] web.mention-rename-refresh-2139.test.js — dSaveHandler() over-captured ~300 lines past the handler: the `.addEventListener(` boundary search overshot into the CREATE-AN-AGENT section, so the docstring's "bounds to itself" claim was inaccurate --> FIXED (a693a6ec): bound to the handler's own column-0 `});` close (verified the only such close between start and 22946 is the handler's own), slice now the actual 111-line handler; docstring corrected.
- [NIT] assertion 1 `/loadProjects\(\)/` was satisfiable by the handler's own comment prose --> FIXED (a693a6ec): changed to `/loadProjects\(\);/` (semicolon form), which matches only the executable statement, not the comments.

#### Iteration 3 — review pass 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** — no new actionable findings; the fix and test confirmed correct on every axis.
- [NIT] assertion 1 is subsumed by assertion 2 (a slice satisfying 2 satisfies 1) --> DEFERRED: intentional diagnostic granularity (assertion 1 red = refresh removed; assertion 2 red = guard changed); harmless, both red when the fix is removed.
- [NIT] the guard keys on `renameTo !== wasCalled` (typed intent), not the server's `ren.changed` --> DEFERRED: loadProjects() is only reached after a 200 (res.ok), where the displayName IS persisted and the picker's shown name DOES become renameTo (a non-ok rename throws before this line); and `ren.changed` is the instruction-FILE rename verdict, not the displayName the picker reads, so `renameTo` is the correct signal. Matches the sibling heading-update pattern (index.html:22926).

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 2 | WARNING | web.mention-rename-refresh-2139.test.js | dSaveHandler() over-captured past the handler | FIXED | a693a6ec |
| 2 | 2 | NIT | web.mention-rename-refresh-2139.test.js | assertion 1 satisfiable by comment prose | FIXED | a693a6ec |
| 3 | 3 | NIT | web.mention-rename-refresh-2139.test.js | assertion 1 subsumed by assertion 2 | DEFERRED | intentional diagnostic granularity |
| 4 | 3 | NIT | web/index.html | guard keys on renameTo not ren.changed | DEFERRED | renameTo is the correct signal for the displayName the picker reads |

### NITs (non-blocking, deferred)
- assertion 1 subsumed by assertion 2 (kept for diagnostic granularity) — iteration 3
- guard keys on renameTo not ren.changed (renameTo is the picker-correct signal) — iteration 3

### Strengths (across all iterations)
- The fix is correct on every axis: loadProjects() is non-awaited (never delays the save feedback), self-catches its read errors, and its auto-open side effects are one-time-flag-guarded (already set before any Save is possible), so it cannot navigate away; PJ_GEN makes the concurrent run alongside tick() safe.
- The name-change guard is sound (cannot miss a real rename, skips role-only saves, worst case is one idempotent re-fetch).
- The static pin is load-bearing and precise: bound to the handler's own close, the semicolon-form assertion avoids comment prose, and both assertions red with the fix removed (verified). The control ties a PROJECTS refresh to the picker (mentionCandidates reads a.name).
- No em dashes (all five spellings) in any changed line; the Browser-check trailer is honest against the #1720 gate.

### Contention note
A validation pass mid-loop went red on the cut-guard/versions-entry tests because a concurrent agent's release cut was running on the shared Mac (bulletin test-machine-claim-1962). Confirmed contention: the tests pass alone, and the change touches only web/index.html d-save + a test file, nothing near release.sh. The final 6j gate ran clean.
