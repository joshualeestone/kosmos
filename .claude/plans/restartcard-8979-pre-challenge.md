---
pre_challenge: true
method: challenge-loop
branch: restartcard-8979
diff_hash: ff0abb183845eb50524efb481cc3821b92eb903ae93429626cd839eb88a5f4ca
validation: passed
subdir_audit: passed
timestamp: 2026-11-24T15:18:46Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 14 (0 BLOCKERs, 9 WARNINGs, 2 CONVENTIONs, 3 actioned NITs; other NITs listed below)
**Fixed:** 12 | **Deferred:** 2 | **Asked (awaiting user):** 0

Initial validation (6.0) failed on one guard, tools.shell-shard-4317 (#1720: a web/ change with no browser-check assertion). Fixed in iteration 1 by adding docs/browser-checks/render-restarted-8979.js (passed in Chromium and WebKit, 1100 and 390 px). Iteration 1's validation then failed two wiring guards (README and gated.txt), fixed in iteration 2. Iterations 2 and 3 validated clean (30340 and 30339 pass, 0 fail).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs actioned (plus the synthetic validation finding)
**Self-generated:** 0 of the above
- [BLOCKER] initial-validation: tools.shell-shard-4317 #1720 browser-check guard failed --> FIXED (3ba69842ea, render-restarted-8979.js)
- [WARNING] engine/win32streamstate.js: a stale sign-in or limit flag outranked the real cause of a later death --> FIXED (3ba69842ea, flags are per dying turn, kept by the supervisor)
- [WARNING] engine/win32supervisor.js: a limit shown in lines that arrive after exit never reached the reason --> FIXED (3ba69842ea)
- [WARNING] engine/win32supervisor.js: a failed --resume replaced the real reason --> FIXED (3ba69842ea)
- [CONVENTION] .claude/plans/restartcard-8979.md: plan out of date (test name, limit source) --> FIXED (3ba69842ea)
- [NIT] at was the death time, not the restart time --> FIXED (3ba69842ea)
- [NIT] a restart over 6 days old showed only a weekday --> FIXED (3ba69842ea)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs (plus the synthetic validation finding)
**Self-generated:** 1 of the above (the deliberate-stop carry, code written in iteration 1)
- [BLOCKER] validation: browser-checks README and runner wiring guards failed --> FIXED (6ac5ce6ad5, gated.txt and README rows)
- [WARNING] engine/win32streamstate.js: stopped() carried a restart record through a deliberate stop --> FIXED (6ac5ce6ad5, carried only by restarting({ keepEarlier }))
- [WARNING] engine/win32streamstate.js: no age limit on the restart line --> DEFERRED: the card asks for exactly "until the next turn succeeds", and an old restart shows its weekday or date, so it never reads as current
**Duplicates of prior findings (confirmed resolved):** 0

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs actioned
**Self-generated:** 2 of the above (page placement and keepEarlier, both code from iterations 1 and 2; fixed as code)
- [WARNING] web/index.html: the restart line hid #7368, #7212 and #8286 sentences that say what to do --> FIXED (4247f2d395, moved after them; page test asserts both win)
- [WARNING] engine/win32supervisor.js: a resume's no-conversation line after exit was missed, so keepEarlier rarely fired --> FIXED (4247f2d395, read above the current-child check)
- [WARNING] engine/win32streamstate.js: an error subtype without is_error cleared the line --> FIXED (4247f2d395)
- [NIT] the supervisor's turn reset did not require a model turn --> FIXED (4247f2d395)
- [NIT] weak notEqual assertion on the stopped card --> FIXED (4247f2d395)
- [NIT] plan named #8972 without #8967 --> FIXED (4247f2d395)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs after deferral, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/win32streamstate.js: restartOnStop survives a failed spawn --> DEFERRED: by design and tested ("a launch that did not spawn keeps the restart for the start that does"); a stopped supervisor's publisher ends with its process, so nothing later reads it
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | initial-validation | BRANCH | #1720 browser-check guard | FIXED | 3ba69842ea |
| 2 | 1 | WARNING | engine/win32streamstate.js | BRANCH | stale auth/limit outranked the cause | FIXED | 3ba69842ea |
| 3 | 1 | WARNING | engine/win32supervisor.js | BRANCH | late limit lines missed | FIXED | 3ba69842ea |
| 4 | 1 | WARNING | engine/win32supervisor.js | BRANCH | failed resume replaced the reason | FIXED | 3ba69842ea |
| 5 | 1 | CONVENTION | .claude/plans/restartcard-8979.md | BRANCH | plan out of date | FIXED | 3ba69842ea |
| 6 | 2 | BLOCKER | validation | BRANCH | browser-check wiring guards | FIXED | 6ac5ce6ad5 |
| 7 | 2 | WARNING | engine/win32streamstate.js | SELF | deliberate stop carried a record | FIXED | 6ac5ce6ad5 |
| 8 | 2 | WARNING | engine/win32streamstate.js | BRANCH | no age limit | DEFERRED | card asks until next good turn; date shown |
| 9 | 3 | WARNING | web/index.html | SELF | restart line hid action sentences | FIXED | 4247f2d395 |
| 10 | 3 | WARNING | engine/win32supervisor.js | SELF | no-conversation after exit missed | FIXED | 4247f2d395 |
| 11 | 3 | WARNING | engine/win32streamstate.js | BRANCH | error subtype cleared the line | FIXED | 4247f2d395 |
| 12 | 4 | WARNING | engine/win32streamstate.js | BRANCH | restartOnStop survives a failed spawn | DEFERRED | by design, tested |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] engine/status.js: restartedOf reads the state file again per snapshot, as unstartedFor does (iterations 1, 4)
- [NIT] engine/win32supervisor.js: turnLimited is turn-scoped, so an earlier limit in the same turn names a later death in it (iteration 2)
- [NIT] web/index.html: a future timestamp from clock skew is not rejected (iteration 3)
- [NIT] plan: an unexpected clean exit (code 0) while running is shown as a restart, "Claude stopped without saying why" (iteration 4)

### Strengths (across all iterations)
- A stop is told from a restart structurally (stop clears the current child first), with tests for both arms
- The reason is read by is_error or an error subtype, never a success subtype; a successful reply never becomes the reason
- exitCodeText gives one spelling shared by the task log and the card, pinned by a test
- Every hop (supervisor, publisher, state file, card, page, browser) is tested, and each fix was shown to fail its test when removed
