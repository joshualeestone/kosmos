---
pre_challenge: true
method: challenge-loop
branch: orgchart-undo-1280
diff_hash: f3ae7e95cb5caaf7ef672173fad4b1cd4c64f041e119dde3f7149c583c2d22fd
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T15:32:37Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 raised NITs only)
**Total findings (distinct, after dedup):** 17 actionable (1 BLOCKER, 14 WARNINGs, 2 CONVENTIONs) plus NITs, plus 1 synthetic (6.0)
**Fixed:** 18 | **Deferred:** 0 | **Asked (awaiting user):** 0

6.0 baseline FAILED on one test (engine/machine.test.js: no live sentence may say "this Mac"; the Undo text
said "stay on this Mac"). That synthetic finding was fixed together with iteration 1's findings. The
6g run after iteration 1 failed only on the browser-check surface gate (the token `msg` is a local
variable here, not the `#msg` element two unrelated checks assert); the iteration 2 commit carries the
per-check `Browser-check-surface:` trailers, and every validation after that passed. Iterations 4 and 5
were committed during a Mortals heavy-run hold (Liu Kang m1663/m1685), so their browser check and 6g
ran after the all-clear (m1716): browser check 35/35 and full validation (10873 tests, 0 failed, hash
f3ae7e95cb5c) on the final HEAD a8d4f18. Iteration 6 was review-only.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 4 NITs (+ the 6.0 synthetic BLOCKER)
**Self-generated:** 0
- [BLOCKER] initial-validation: engine/machine.test.js "this Mac" wording --> FIXED (a1948c1, "this computer")
- [WARNING] docs/browser-checks/render-orgchart-import-1280.js:150 — the Create POST body check was dropped --> FIXED
- [WARNING] web/index.html — an engine `partial` shown as "not removed" and retried forever --> FIXED (re-read /api/removed)
- [WARNING] web/index.html — the page composed its own removal description --> FIXED (engine plan words)
- [WARNING] web/index.html — keyboard focus lost at every step --> FIXED
- [WARNING] web/index.html — Back to the list hid a running removal --> FIXED (steps aside)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [WARNING] web/index.html:43012 — Preview/reset did not supersede an in-flight ask or removal --> FIXED (9e7005b, GEN bumps + Preview disabled)
- [WARNING] web/index.html:43037 — a 500 plan read as fine --> FIXED ("could not check")
- [BLOCKER] 6g: browser-check surface gate on token `msg` --> FIXED (per-check trailers, 9e7005b)

#### Iteration 3
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 5 NITs
**Self-generated:** 2 (the plans map and the ask sentence written by iteration 1's fix)
- [WARNING] docs/browser-checks/render-orgchart-import-1280.js — "fresh preview drops Undo" could not fail --> FIXED (2896f6e)
- [WARNING] web/index.html:43009 — ORGCHART_UNDO_PLANS unused --> FIXED (refused plans get no DELETE)
- [WARNING] web/index.html:43041 — every plan refused but Remove still offered --> FIXED
- [CONVENTION] docs/browser-checks/render-orgchart-import-1280.js:48 — stale "one intercept" comment --> FIXED
- [CONVENTION] web/index.html:43047 — engine words lowercased and mis-joined --> FIXED (verbatim, "; ")

#### Iteration 4
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the "removed, but" row wording from iteration 1)
- [BLOCKER] web/index.html:43120 — a clean removal read "removed, but ... has been removed"; the mock never sent the engine's real sentence --> FIXED (a751081; mock now sends it)
- [WARNING] web/index.html:42891 — Preview during an in-flight create dropped the result --> FIXED (ORGCHART_CREATING)
- [WARNING] web/index.html:43016 — Back to the list visible while plans load --> FIXED
- [WARNING] docs/browser-checks/render-orgchart-import-1280.js:379 — leave-mid-run arm could not see a second DELETE --> FIXED (two agents, asserted one call)
- [WARNING] web/index.html:43049 — first plan's losses stated for all --> FIXED (per-row "this one loses")

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] web/index.html:43114 — the plan-refused skip path had no clicked coverage --> FIXED (a8d4f18, mixed run asserts no DELETE for it)

#### Iteration 6
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 0 | BLOCKER | initial-validation | BRANCH | "this Mac" in page text | FIXED | a1948c1 |
| 2 | 1 | WARNING | render-orgchart-import-1280.js:150 | BRANCH | Create POST check dropped | FIXED | a1948c1 |
| 3 | 1 | WARNING | web/index.html (go handler) | BRANCH | partial shown as not removed | FIXED | a1948c1 |
| 4 | 1 | WARNING | web/index.html (ask) | BRANCH | page composed removal words | FIXED | a1948c1 |
| 5 | 1 | WARNING | web/index.html (ask/keep/go) | BRANCH | focus lost | FIXED | a1948c1 |
| 6 | 1 | WARNING | web/index.html (edit) | BRANCH | Back hid a running removal | FIXED | a1948c1 |
| 7 | 2 | WARNING | web/index.html:43012 | BRANCH | no supersede on preview/reset | FIXED | 9e7005b |
| 8 | 2 | WARNING | web/index.html:43037 | BRANCH | 500 plan read as fine | FIXED | 9e7005b |
| 9 | 2 | BLOCKER | 6g surface gate | BRANCH | token msg flagged two checks | FIXED | 9e7005b trailers |
| 10 | 3 | WARNING | render-orgchart-import-1280.js | BRANCH | vacuous fresh-preview check | FIXED | 2896f6e |
| 11 | 3 | WARNING | web/index.html:43009 | SELF | plans map unused | FIXED | 2896f6e |
| 12 | 3 | WARNING | web/index.html:43041 | SELF | all refused, Remove offered | FIXED | 2896f6e |
| 13 | 3 | CONVENTION | render-orgchart-import-1280.js:48 | BRANCH | stale comment | FIXED | 2896f6e |
| 14 | 3 | CONVENTION | web/index.html:43047 | BRANCH | engine words altered | FIXED | 2896f6e |
| 15 | 4 | BLOCKER | web/index.html:43120 | SELF | "removed, but ... removed" | FIXED | a751081 |
| 16 | 4 | WARNING | web/index.html:42891 | BRANCH | Preview dropped create result | FIXED | a751081 |
| 17 | 4 | WARNING | web/index.html:43016 | BRANCH | Back visible during plan load | FIXED | a751081 |
| 18 | 4 | WARNING | render-orgchart-import-1280.js:379 | BRANCH | mid-run arm blind to 2nd DELETE | FIXED | a751081 |
| 19 | 4 | WARNING | web/index.html:43049 | BRANCH | first plan's losses for all | FIXED | a751081 |
| 20 | 5 | WARNING | web/index.html:43114 | BRANCH | skip path untested | FIXED | a8d4f18 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, still open)
- [NIT] web/index.html:42791 — after a mode switch during an in-flight create, Preview looks enabled but ignores a press until the create answers (iteration 6)
- [NIT] web/index.html:43148 — a recorded partial reads "removed, but we stopped X ..., but ..." (the engine's partial sentences already contain "but"); the mock's sentence does not show it (iteration 6)
- [NIT] web/index.html:43018 — the ask's block comment sits above two helper declarations (iteration 6)
- [NIT] web/index.html:43036 — the plan GETs have no timeout, and Back is hidden while they load (iteration 6)
- [NIT] render-orgchart-import-1280.js:69 — the mock answers an ok:false plan at 200 (the real route says 400; the page reads the body either way); removedNow is never cleared between arms (iteration 6)
- [NIT] web/index.html — two /api/removed reads per Undo (its own and paintRemoved's) (iteration 5)
- [NIT] web/index.html — an unreadable plan is shown as "could not check" and is still attempted (iteration 5)

### Strengths (across all iterations)
- Undo reads only created[] from the create response, never the board or refused[], so an agent that existed before the import cannot be reached (all iterations)
- It uses the existing reversible removal route, and resolves the engine's two-meaning `partial` by re-reading /api/removed (iterations 2, 4, 5, 6)
- The generation guard is re-checked after every await in ask and remove, and a check asserts leaving mid-run sends no further DELETE (iterations 3, 4, 6)
- Every new behaviour has a browser-check arm with a control; engine and user strings reach innerHTML only through esc (iterations 1, 5, 6)
