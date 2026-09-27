---
pre_challenge: true
method: challenge-loop
branch: dock-badge-3996
diff_hash: 7066cb21ef08273e841625be121c4954501d6fdcc6bad8bd0cd714b4a0a816d2
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T20:29:14Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8 found no BLOCKER, WARNING or CONVENTION; two NITs)
**Total findings:** 30 (1 BLOCKER, 13 WARNINGs, 0 CONVENTIONs, 16 NITs)
**Fixed:** 22 | **Deferred:** 8 | **Asked (awaiting user):** 0

Full validation passed at 486f46792 (validation-log hash 7066cb21ef08, the diff_hash above); subdir audit passed. The first full validation (4bcdd9f0f) failed only on fixture discipline (the new engine test built agent cards by hand), fixed at be42d892f. The Swift app compiles with no warnings (also at the macOS 13.5 floor target), and `--kosmos-app-badge-selftest` passes 18/18 rows. The browser-check gate passes through a documented `Browser-check:` trailer (the page change draws nothing); the surface gate passes.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] native-app/main.swift badgesAllowed: the "macOS badge setting wins" promise is unreachable (an app that never asked for notification permission has no Badges switch) --> FIXED (9ca55dc0a: honest wording; in-app off switch filed as #4025)
- [WARNING] native-app/main.swift: App Nap may slow both timers with the window hidden --> DEFERRED: measure on a served build; tolerance and common run-loop mode added (9ca55dc0a)
- [WARNING] native-app/main.swift: polling /api/status (the heaviest route) adds 50% load --> FIXED (9ca55dc0a: the page hands the app its count; the app polls only when the page is quiet)
- [NIT] answers could apply out of order --> FIXED (9ca55dc0a)
- [NIT] a missing badge left no trace in the log --> FIXED (9ca55dc0a)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the origin check added in iteration 1)
- [WARNING] BadgeMessageProxy checked the host only, not the port --> FIXED (ddae007f2)
- [WARNING] the badge setting was asked on every update --> FIXED (ddae007f2: cached 5 minutes)
- [WARNING] App Nap affects both sources alike --> DEFERRED: same measure-first call, recorded in the plan
- [NIT] a silent catch in tick() --> DEFERRED: the expected non-Mac case, not worth a log per poll
- [NIT] the localhost branch was dead --> FIXED (ddae007f2)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above
- [WARNING] under the KOSMOS_URL override the badge was off with no log --> FIXED (565dccf5b: the page feeds it; the log says so)
- [NIT] cold launch logged a failure then a recovery --> FIXED (565dccf5b)
- [NIT] an old board without the count set the app polling --> FIXED (565dccf5b: the page posts null)
- [NIT] the label was reassigned on every post --> FIXED (565dccf5b)
- [NIT] the setting cache had no main-thread guard --> FIXED (565dccf5b: dispatchPrecondition)
- [NIT] the 5-minute gate was not pinned by the test --> FIXED (565dccf5b)
- [NIT] the server test fixture has no unread project message --> DEFERRED: the engine test controls each part

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above (the 12 s threshold from iteration 1)
- [BLOCKER] the browser-check gate failed: web/ changed with no browser-check update and no trailer --> FIXED (1afd12a87: a Browser-check trailer, the page change draws nothing; the handoff is pinned from source and by the selftest)
- [WARNING] the 12 s page-quiet threshold exceeded the 10 s tick (worst case about 20 s) --> FIXED (1afd12a87: 8 s)
- [NIT] boardTokenValue read on the main thread each tick --> DEFERRED: tiny file, mirrors the stale check

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] a board that refuses from the start was never logged --> FIXED (84a09e2c3: a refusal is logged at once with its code)
- [WARNING] one slow answer blanked the badge --> FIXED (84a09e2c3: cleared only after three misses)
- [NIT] KOSMOS_URL without a port: WebKit reports 0 --> FIXED (84a09e2c3)
- [NIT] a page post and an app poll ordered by different moments --> DEFERRED: corrects itself within one page tick
- [NIT] the tick-post test only matched the line anywhere --> FIXED (84a09e2c3: sliced to tick())
- [NIT] the plan named badgeLabel(fromStatus:) --> FIXED (84a09e2c3)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the three-miss rule from iteration 5)
- [WARNING] a 200 whose body did not parse skipped the three-miss rule --> FIXED (78e2ee017: readsAsStatus)
- [NIT] the scheme is not part of the trust check --> FIXED (78e2ee017: comment)
- [NIT] two cold-start setting asks can run at once --> DEFERRED: once per process, harmless
- [NIT] floor vs reject of fractional counts across server and app --> DEFERRED: the server always sends an integer sum

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the miss count from iteration 5)
- [WARNING] page posts never reset the app's miss count --> FIXED (486f46792)
- [NIT] wall-clock timing could step backwards --> FIXED (486f46792: systemUptime)
- [NIT] readsAsStatus had no selftest rows --> FIXED (486f46792: 18 rows)
- [NIT] the page posts before later tiles paint --> DEFERRED: the Dock number is the server's
- [NIT] the server test cannot see the counts ordering --> DEFERRED: engine test controls each part

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings.
- [NIT] a successful read parses the JSON twice
- [NIT] a cold-start duplicate setting ask (once per process)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | native-app/main.swift badgesAllowed | BRANCH | macOS setting unreachable | FIXED | 9ca55dc0a, #4025 |
| 2 | 1 | WARNING | native-app/main.swift timer | BRANCH | App Nap | DEFERRED | measure on a served build |
| 3 | 1 | WARNING | native-app/main.swift refresh | BRANCH | heavy-route polling | FIXED | 9ca55dc0a |
| 4 | 2 | WARNING | BadgeMessageProxy | SELF | host-only origin check | FIXED | ddae007f2 |
| 5 | 2 | WARNING | badgesAllowed | BRANCH | asked every update | FIXED | ddae007f2 |
| 6 | 3 | WARNING | loadBoard KOSMOS_URL | BRANCH | badge off under override | FIXED | 565dccf5b |
| 7 | 4 | BLOCKER | web/index.html | BRANCH | browser-check gate | FIXED | 1afd12a87 |
| 8 | 4 | WARNING | refreshDockBadge | SELF | 12 s over the 10 s tick | FIXED | 1afd12a87 |
| 9 | 5 | WARNING | refreshDockBadge | BRANCH | refusal from start unlogged | FIXED | 84a09e2c3 |
| 10 | 5 | WARNING | refreshDockBadge | BRANCH | one slow answer blanks | FIXED | 84a09e2c3 |
| 11 | 6 | WARNING | refreshDockBadge | SELF | unparsed 200 skips misses | FIXED | 78e2ee017 |
| 12 | 7 | WARNING | pageSaidWaiting | SELF | miss count never reset | FIXED | 486f46792 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] a successful read parses the JSON twice (iteration 8)
- [NIT] a cold-start duplicate setting ask (iterations 6, 8)
- [NIT] the page posts before later tiles paint (iteration 7, deferred)
- [NIT] App Nap to be measured on a served build (iterations 1, 2, deferred)

### Strengths (across all iterations)
- One number, defined once in the engine and shown by both the page's tiles and the Dock (iteration 1)
- The two sources cannot flap: both carry the server's raw number, applied in the order asked (iterations 3, 7)
- The build gate refuses an exit 0 with no verdict and a gutted selftest, like the #1042 gate (iterations 1, 7)
