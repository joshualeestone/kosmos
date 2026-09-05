---
pre_challenge: true
method: challenge-loop
branch: neverrun-roster-1078
diff_hash: 6a8d97b838c6d695f5256bfc3d7ecb7539bc25c64b0bcb6972f2d90e3add77cd
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T05:29:26Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found 0 BLOCKERs/WARNINGs/CONVENTIONs after dedup)
**Total findings:** 3 BLOCKERs (0), WARNINGs (3), CONVENTIONs (0), NITs (5)
**Fixed:** all actionable (3 WARNINGs + 5 NITs) | **Deferred:** 0 | **Asked:** 0

Reviewer models varied per the directive: iter 1 Sonnet, iter 2 Opus, iter 3 Sonnet.
All reviewers pointed at `origin/main...HEAD` (local main is stale).

### Per-Iteration Breakdown

#### Iteration 1 (Sonnet)
**New findings:** 0 BLOCKERs, 1 WARNING, 3 NITs, 3 STRENGTHs
- [WARNING] createdroster.test.js:126 — a test titled "safeKey rejects → skipped" did not exercise that branch (its `___` name is a VALID key); the safeKey try/catch was unverified --> FIXED (e9ec5a4e): renamed the underscore test + added a real punctuation-name test that drives safeKey to throw → skipped.
- [NIT] createdroster.js:87 — sandboxIsInconsistent()/removedNames() unguarded vs the "never throws → []" docblock contract --> FIXED (e9ec5a4e): both wrapped in try/catch → [].
- [NIT] server.js:9050 — comment said "on the Mac" but the gate is `!== win32` (also Linux) --> FIXED (e9ec5a4e): comment corrected.
- [NIT] createdroster.js:9 — header cited `discover.foundCreated` as a live symbol (it is the earlier unmerged approach) --> FIXED (e9ec5a4e): cite the live win32sessions/win32roster sibling + discover.foundCodex.

#### Iteration 2 (Opus)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 NIT, 4 STRENGTHs
**Duplicates of prior findings:** 0
- [WARNING] status.js:4613 — VERIFIED BY EXECUTION: the NEVER_RUN_DEFAULT comment claimed a ran-then-cold agent surfaces its last decayed report; reconcileReport Rule 2 short-circuits on a STOPPED/STRUCTURED default, so the card is ALWAYS STOPPED --> FIXED (52b7a83f): comment rewritten to the real mechanism.
- [WARNING] status.js:4616 — consequence: the `because` copy "has not been started yet" is factually wrong for a ran-then-cold agent this source also lists --> FIXED (52b7a83f): copy changed to "is not running right now" (true of every card here); added a non-vacuous Rule-2 regression test (stale `blocked` report → card is STOPPED, not blocked).
- [NIT] createdroster.js:101 — removedSet uses cleanName not slugFor --> FIXED (52b7a83f): documented that cleanName is the SAME key remove.js records under (matching its own isRemoved), which is the invariant to preserve.

#### Iteration 3 (Sonnet)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs, 6 STRENGTHs
**Converged** — no new actionable findings. The 2 NITs are doc-accuracy points:
- [NIT] status.js:4635 — the panelessCard shared-framing sentence implied BOTH defaults mean "nothing said yet" --> FIXED (e38f5be1): reworded (NEVER_RUN_DEFAULT is a positive STOPPED claim).
- [NIT] plan:39 — merge-order narration (boardKeys built "after" the loop) didn't match the code (seeded before, extended during) --> FIXED (e38f5be1): plan corrected.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | createdroster.test.js:126 | safeKey-throw branch unverified; misnamed test | FIXED | e9ec5a4e |
| 2 | 1 | NIT | createdroster.js:87 | unguarded calls vs "never throws" contract | FIXED | e9ec5a4e |
| 3 | 1 | NIT | server.js:9050 | comment "Mac" vs `!== win32` gate | FIXED | e9ec5a4e |
| 4 | 1 | NIT | createdroster.js:9 | header cites non-live discover.foundCreated | FIXED | e9ec5a4e |
| 5 | 2 | WARNING | status.js:4613 | comment misdescribes reconcileReport Rule 2 | FIXED | 52b7a83f |
| 6 | 2 | WARNING | status.js:4616 | "has not been started yet" copy wrong for ran-then-cold | FIXED | 52b7a83f |
| 7 | 2 | NIT | createdroster.js:101 | cleanName-vs-slugFor normalization note | FIXED | 52b7a83f |
| 8 | 3 | NIT | status.js:4635 | shared-framing sentence implies both defaults are "unknown" | FIXED | e38f5be1 |
| 9 | 3 | NIT | plan:39 | merge-order narration mismatch | FIXED | e38f5be1 |

### NITs (non-blocking, across all iterations)
All NITs above were fixed rather than deferred (each was a cheap accuracy improvement).

### Strengths (across all iterations)
- Dedup keyspace verified in the code, not assumed: created plist name = launchd label = tmux session name = one slugFor slug, `-discord` forbidden at creation, safeKey applied identically both sides — a running instance always dedups to its richer pane card (iters 1, 2, 3).
- Dedup covers the paneless-beat keyspace too (boardKeys seeded from paneKeys, extended with each pushed paneless key before createdSource is called) (iter 3).
- Fail-closed design thorough and every arm perturbation-tested with a positive control: unreadable removed.json → [], inconsistent sandbox → [] before readdir, foreign/malformed plist skipped, missing worker dir skipped, readdir throw → [], un-keyable name swallowed (iters 1, 2, 3).
- Correct fail-closed choice: removedNames() (ok:false on unreadable) over the fail-open isRemoved() (iter 1).
- Additivity real and tested: createdSource default null → snapshot() byte-identical; panelessCard param defaults to the preserved PANELESS_DEFAULT; counts leave paneless STOPPED cards out of the read-failure buckets (iters 1, 2, 3).
- STOPPED/STRUCTURED wired through reconcileReport Rule 2, verified by execution via a planted stale self-report, not only by comment (iters 2, 3).
