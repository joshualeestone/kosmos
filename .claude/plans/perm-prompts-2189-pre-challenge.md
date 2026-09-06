---
pre_challenge: true
method: challenge-loop
branch: perm-prompts-2189
diff_hash: f32139696764e15664e9ffb0aad0db773611dbec02bb323641b69e9c255735e4
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T17:40:37Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 surfaced no new BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, ~9 NITs
**Fixed:** 5 WARNINGs (4 in code, 1 documented+deferred by design) · 1 CONVENTION (comment) · 6 NITs
**Deferred:** 1 CONVENTION (refactor) · parts of 2 WARNINGs/NITs (fresh-Mac verify; Renet UI)

Each iteration was a fresh, blind Agent-tool review (no access to prior findings); full
suite (`tools/run-tests.sh`) + swiftc floor-target compile run green after every round.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] native-app/main.swift fileAccessReading — early-returned on the first
  ungranted folder, so one click fired only one of three folder prompts --> FIXED
  (ce708402): probe all three unconditionally, granted = all succeeded.
- [WARNING] native-app/main.swift consumeRequest — a stray request from a prior run
  fired a surprise prompt on relaunch --> FIXED (ce708402): drop requests older than 30s.
- [CONVENTION] native-app/main.swift storeFileURL — comment overclaimed while the inline
  a11yStatusURL sibling re-implements the resolution --> comment FIXED (ce708402);
  refactor DEFERRED (a11yStatusURL's #2125 writer test pins its inline body).
- [NIT] engine/promptrequest.js nativePresent coupling --> FIXED (ce708402): note added.
- [NIT] consumeRequest delete-before-fire loses a request on transient failure -->
  escalated and FIXED in iteration 2.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 3 NITs
- [WARNING] native-app/main.swift consumeRequest — fired even if the best-effort delete
  failed, re-firing the TCC prompt every 1.5s until staleness (prompt spam) --> FIXED
  (6e12c560): non-optional `try removeItem` in do/catch; fire only on a successful
  consume.
- [NIT] checkPromptRequests resolved the install every 1.5s tick --> FIXED (6e12c560):
  fileExists before resolveInstall.
- [NIT] the immediate axcheck comment overstated its effect --> FIXED (6e12c560).
- [NIT] TCC-denied folder leaves no Settings fallback --> DEFERRED (inherent to TCC,
  lives on Renet's UI side; flagged to Renet).

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] server.js — the route-name contract with Renet's frFirePermission caller was
  untested --> FIXED (c1901a44): a test asserts server.js handles exactly the /api/*-prompt
  paths web/index.html POSTs (read-only, both sides).
- [NIT] the pending-check names array could drift from consumeRequest --> FIXED
  (c1901a44): a test pins them equal.
- [NIT] resolveInstall-every-tick on a delete failure --> DEFERRED (path is already safe;
  nothing fires; self-heals).

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] native-app/main.swift — the file-access single-click flip assumes
  contentsOfDirectory blocks until the user answers; if async, granted:false is written
  with no refresh path --> code DEFERRED, DOCUMENTED (1c07ef7b): the fix (bounded
  post-click re-probe) needs the fresh-Mac timing measurement, and a naive periodic
  refresh would reintroduce permflood-2125's fresh-install prompt burst; flagged in the
  plan's weakest-premise for Josh's verify.
- [NIT] test source paths were cwd-relative --> FIXED (1c07ef7b): __dirname-relative.
- [NIT] staleness not covered under persistent resolveInstall failure --> DEFERRED
  (already safe; nothing fires).

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** — no new actionable findings.
- [NIT] resolveInstall-failure lingering file --> duplicate of iteration 4 (deferred).
- [NIT] stale-drop logged "dropped" even when the delete failed --> FIXED (a685a615):
  honest do/catch log.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | main.swift fileAccessReading | early-return on first ungranted folder | FIXED | ce708402 |
| 2 | 1 | WARNING | main.swift consumeRequest | stale request fires surprise prompt | FIXED | ce708402 |
| 3 | 1 | CONVENTION | main.swift storeFileURL | comment vs inline a11yStatusURL | FIXED(comment)/DEFERRED(refactor) | ce708402 / pinned #2125 test |
| 4 | 1 | NIT | promptrequest.js nativePresent | coupling note | FIXED | ce708402 |
| 5 | 2 | WARNING | main.swift consumeRequest | fire-on-delete-failure re-fire spam | FIXED | 6e12c560 |
| 6 | 2 | NIT | main.swift checkPromptRequests | resolveInstall every tick | FIXED | 6e12c560 |
| 7 | 2 | NIT | main.swift checkPromptRequests | axcheck comment overstates | FIXED | 6e12c560 |
| 8 | 2 | NIT | (UI seam) | TCC-denied no Settings fallback | DEFERRED | Renet UI side |
| 9 | 3 | WARNING | server.js routes | route-name contract untested | FIXED | c1901a44 |
| 10 | 3 | NIT | main.swift checkPromptRequests | names array could drift | FIXED | c1901a44 |
| 11 | 3 | NIT | main.swift checkPromptRequests | resolveInstall on delete failure | DEFERRED | already safe |
| 12 | 4 | WARNING | main.swift fileAccessReading | prompt timing/refresh unknown | DEFERRED+DOC | 1c07ef7b / fresh-Mac verify |
| 13 | 4 | NIT | perm-prompts test | cwd-relative paths | FIXED | 1c07ef7b |
| 14 | 4 | NIT | main.swift | staleness uncovered under resolve failure | DEFERRED | already safe |
| 15 | 5 | NIT | main.swift consumeRequest | inaccurate stale-drop log | FIXED | a685a615 |

### Deferred items (with reasoning)
- **storeFileURL/a11yStatusURL duplication (CONVENTION):** a11yStatusURL's #2125 writer
  test pins its inline body; routing it through storeFileURL would perturb a proven-path
  test. Comment corrected so it no longer overclaims. Refactor is safe follow-up.
- **file-access prompt timing/refresh (WARNING):** two unknowns (attribution; sync-vs-async
  timing) are unobservable on a dev box with Full Disk Access; the honest reading ships
  with no bias default so Josh's fresh-Mac verify measures both. A naive periodic refresh
  would reintroduce permflood-2125's prompt burst; the correct fix (bounded post-click
  re-probe) is deferred until the verify says it is needed. **Prod-promote stays HELD.**
- **TCC-denied leaves no Settings fallback (NIT):** inherent to TCC (macOS does not
  re-prompt a decided folder); the affordance lives on Renet's UI side — flagged to her.
- **resolveInstall-failure lingering request (NIT):** already safe (nothing fires),
  self-heals on next successful resolve/restart.

### NITs (non-blocking)
- All actionable NITs above were fixed; the deferred ones are recorded with reasoning.

### Strengths (across iterations)
- Cross-boundary seams pinned from BOTH sides (request-file names JS<->Swift, route
  strings server.js<->web/index.html, JSON shape Swift<->fileaccessstatus.js, names-array
  vs consumeRequest) — real pins, not comments.
- Security: new POST routes inherit the pre-route cross-site + board-token guards; `kind`
  is a hardcoded whitelist key (no traversal/injection); body never parsed.
- Swift concurrency clean: main-runloop Timer (no re-entrancy), [weak self], detached
  hatch (no beachball); delete-before-fire + fire-only-on-successful-delete prevents both
  double-fire and re-fire spam.
- The two genuinely-unverifiable-on-a-dev-box unknowns are documented in code and plan and
  routed to the fresh-Mac verify rather than silently assumed; no bias default.
