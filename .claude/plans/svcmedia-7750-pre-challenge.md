---
pre_challenge: true
method: challenge-loop
branch: svcmedia-7750
diff_hash: cd002f04c14d8348d4ca134f731e68114b6b915eb310f95dfd89d244d9ef7e14
validation: passed
subdir_audit: passed
timestamp: 2026-11-15T10:25:01Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 22 (0 BLOCKERs, 13 WARNINGs, 0 CONVENTIONs, 9 NITs acted on or recorded; validation reds counted as BLOCKERs below)
**Fixed:** 12 | **Deferred:** 4 | **Asked (awaiting user):** 0

Validation (full suite, 29167 tests) ran before iteration 1 and found 2 reds (synthetic BLOCKERs, Origin BRANCH), both fixed in iteration 1. The final 6j run on e7df76de: 0 failures, REAL_EXIT=0, audit 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs (validation), 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] initial-validation: browser-checks-teardown-guard-6022 (mobile-shots.js:401 fulfill outside a try) --> FIXED (5f7318b5)
- [BLOCKER] initial-validation: tools.shell-shard-4317 via the #2518 surface gate (four Connections checks) --> FIXED (5f7318b5, per-check trailers on every commit, each check read first)
- [WARNING] engine/tokendoors.js:161 ElevenLabs hint led to keys the check refuses --> FIXED (5f7318b5, Mona Lisa's wording; shortened in f0884918)
- [WARNING] engine/tokendoors.js:169 non-auth reason shown bare --> FIXED (5f7318b5, "ElevenLabs answered N: why")
- [WARNING] engine/tokendoors.test.js:180 detail as a string not handled --> FIXED (5f7318b5)
- [WARNING] plan step 4 wider tests not run --> FIXED (20 files 244 tests + web.conn-shelf, all pass)
- [NIT] web.svc-doors.test.js:113 source-text pin
- [NIT] mobile-shots.js:2155 screens split the #5787 comment
- [NIT] mobile-shots.js:386 "will" stale --> FIXED (5f7318b5)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (stale ownership comment half)
- [WARNING] web/index.html:48877 built pills also lose their dimming --> DEFERRED: intended, Mona Lisa confirmed (Fleet Builders m4359)
- [WARNING] web/index.html:48877 a name mismatch would keep "coming" --> DEFERRED: the same name lookup opens the door, so a mismatch breaks the door itself and is caught there
- [WARNING] mobile-shots.js:386 mock copies the door words --> FIXED (7dea9d03, reads the engine spec)
- [NIT] service text shown on the page (escaped, capped)
- [NIT] first_name null case
- [NIT] keep weakest premise in PR body

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] mobile-shots.js:2160 comment said the engine rows did not exist --> FIXED (1294e3e5, sentence deleted)
- [NIT] mobile-shots.js:2158 screens split the #5787 comment --> FIXED (1294e3e5)
- [NIT] mobile-shots.js:384 helper split the networkidle comment --> FIXED (1294e3e5)
- [NIT] ElevenLabs hint long --> FIXED (f0884918, Mona Lisa's shorter wording m4361)
- [NIT] service text in route answers
- [NIT] source-text pin

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (2 raised, both duplicates of deferred entries), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [NIT] tokendoors.js:152 Replicate 200 without username read "answered 200" --> FIXED (7d09b1a1)
- [NIT] mobile-shots.js:382 helper split the deep-links comment --> FIXED (7d09b1a1)
- [NIT] hint long (already changed)
- [NIT] source-text pin

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the ElevenLabs accept function, written in this loop)
- [WARNING] tokendoors.js:169 ElevenLabs 200 without user_id read "answered 200" --> FIXED (e7df76de, own sentence and test arm)
- [WARNING] web.svc-doors.test.js:115 source-text pin --> DEFERRED: duplicate of the iteration 1 NIT; the page suite reads source by design, and the pill behaviour is shown in the design shots
- [NIT] status number in non-auth sentence (matches the core wording)
- [NIT] tab-wide pill change to name in the PR body (done)
- [NIT] mobile-shots.js:392 svc route fulfill unguarded --> FIXED (e7df76de)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (1 raised, duplicate of the deferred tab-wide pill change), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | docs/browser-checks/mobile-shots.js:401 | BRANCH | #6022 route fulfill outside a try | FIXED | 5f7318b5 |
| 2 | 1 | BLOCKER | tools.shell-shard-4317 / surface gate | BRANCH | four Connections checks flagged stale | FIXED | 5f7318b5 trailers |
| 3 | 1 | WARNING | engine/tokendoors.js:161 | BRANCH | hint leads to refused keys | FIXED | 5f7318b5, f0884918 |
| 4 | 1 | WARNING | engine/tokendoors.js:169 | BRANCH | non-auth reason bare | FIXED | 5f7318b5 |
| 5 | 1 | WARNING | engine/tokendoors.test.js:180 | BRANCH | detail string unhandled | FIXED | 5f7318b5 |
| 6 | 1 | WARNING | .claude/plans/svcmedia-7750.md:18 | BRANCH | wider tests unrun | FIXED | run, plan updated |
| 7 | 2 | WARNING | web/index.html:48877 | BRANCH | built pills undimmed | DEFERRED | intended, Mona Lisa m4359 |
| 8 | 2 | WARNING | web/index.html:48877 | BRANCH | name mismatch keeps coming | DEFERRED | door lookup fails the same way |
| 9 | 2 | WARNING | docs/browser-checks/mobile-shots.js:386 | BRANCH | mock copies words | FIXED | 7dea9d03 |
| 10 | 3 | WARNING | docs/browser-checks/mobile-shots.js:2160 | BRANCH | false comment | FIXED | 1294e3e5 |
| 11 | 5 | WARNING | engine/tokendoors.js:169 | SELF | ElevenLabs 200 no user_id | FIXED | e7df76de |
| 12 | 5 | WARNING | web.svc-doors.test.js:115 | BRANCH | source-text pin | DEFERRED | page suite reads source by design |

### NITs (non-blocking, across all iterations)
- web.svc-doors.test.js:113 source-text pin (iterations 1, 3, 4, 6)
- service-returned text shown, escaped and capped at 300 characters (iterations 2, 3, 6)
- first_name may be null; the door then shows Connected with no name (iteration 2)
- "token" vs ElevenLabs' "key" in the shared refusal wording (iteration 6)
- status number in a non-auth refusal (iteration 5)

### Strengths (across all iterations)
- Both doors refuse a 200 that names no account (iterations 1, 3, 5)
- The door is pure data: routes and connection lists follow the spec row (iteration 5)
- The shots read their words from the engine spec, so they cannot drift (iterations 3, 6)
- Refused keys are never written to disk, asserted in the test (iterations 1, 5)
- The weakest premise is stated in the plan and both rows stay proven: false (iterations 2, 5, 6)
