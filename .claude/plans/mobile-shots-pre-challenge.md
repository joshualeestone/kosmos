---
pre_challenge: true
method: challenge-loop
branch: mobile-shots
diff_hash: bd023d5c729caa6567e1c43a47f4a0b71aec0fbb7aca45f5fa48adba31a8662f
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T13:09:08Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

This run reviewed the harness after rebasing it onto origin/main (137 commits, then again after the org chart
merge). An earlier loop on this branch (iterations 1-4, 2026-09-25) is recorded in the plan; this proof covers the
new run. Each iteration's changes are also recorded in .claude/plans/mobile-shots-20260925T0502.md.

**Iterations:** 10 (blind reviews; 6.0 validation found #3675's missing lib-sandbox-home, fixed with iteration 1)
**Converged:** Yes
**Total findings:** 20 actionable (1 BLOCKER, 17 WARNINGs, 2 CONVENTIONs) plus ~30 NITs
**Fixed:** 20 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER (6.0), 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] 6.0 validation: tools.browser-checks-home-3675 — a board-booting check must require lib-sandbox-home at top level --> FIXED (60cd16e46)
- [WARNING] screens that did not assert arrival (agent-page, agent-chat, agent-profile, agent-instructions, projects) --> FIXED (60cd16e46)
- [WARNING] create-agent reached by a scripted click --> FIXED (real tap; measured reachable at 375, both engines)
- [WARNING] leak scan and shot were two reads --> FIXED (scan again after the shot; a late hit deletes the shot)
- [WARNING] a failed seed left the sandbox roots; board stderr lived in DATA --> FIXED
- [CONVENTION] plan drift (later screens, sweep size, reason-grep count) --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] LAUNCH / PROJECTS not set in-process before the engine writers --> FIXED (f3341ea03)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] Playwright's browser cache depended on require order once HOME was sealed --> FIXED (pinned first, 90db990f0)
- [WARNING] naming CODEX_HOME and friends put the board in the #1488 named-home mode --> FIXED (left unset)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
- [WARNING] a masked email still printed its first character and domain --> FIXED (kind and length only, 2daeb6559)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 8 NITs
**Self-generated:** 2 of the above (the iteration-4 mask comment and the key-scan comment)
- [WARNING] keys still printed six characters; same-length hits collapsed --> FIXED (5164e41fb)
- [WARNING] key-scan comment overstated its coverage --> FIXED (it now names the preflight as the guard for masked keys)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] Gemini (AIza) and Grok (xai-) keys not scanned --> FIXED (7f6882359)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] report.json tap-target names were never leak-checked --> FIXED (e7a827bb8)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine writers that report failure as { recorded: false } were not checked --> FIXED (b254c1864)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above (the report check added in iteration 7 ran before page errors were appended)
- [WARNING] reason-grep count stale after main moved --> FIXED (rebased; 172, measured)
- [WARNING] the report check ran before the note was complete --> FIXED
- [WARNING] no control for the rescan, report scan or home/key/email checks --> FIXED (lib-leak-guard.js and tools.mobile-shots-leak-718.test.js; controls fail when the key pattern narrows or the home check is case-sensitive)
- [CONVENTION] header / README wording narrower than the code --> FIXED

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | mobile-shots.js (6.0) | BRANCH | no lib-sandbox-home | FIXED | 60cd16e46 |
| 2 | 1 | WARNING | mobile-shots.js screens | BRANCH | screens did not assert arrival | FIXED | 60cd16e46 |
| 3 | 1 | WARNING | mobile-shots.js create-agent | BRANCH | scripted click | FIXED | 60cd16e46 |
| 4 | 1 | WARNING | mobile-shots.js capture | BRANCH | one scan before the shot | FIXED | 60cd16e46 |
| 5 | 1 | WARNING | mobile-shots.js startBoard | BRANCH | seed failure / stderr | FIXED | 60cd16e46 |
| 6 | 1 | CONVENTION | plan | BRANCH | plan drift | FIXED | 60cd16e46 |
| 7 | 2 | WARNING | mobile-shots.js seedFiles | BRANCH | LAUNCH/PROJECTS | FIXED | f3341ea03 |
| 8 | 3 | WARNING | mobile-shots.js HOME | BRANCH | Playwright cache order | FIXED | 90db990f0 |
| 9 | 3 | WARNING | mobile-shots.js sealed | BRANCH | named-home mode | FIXED | 90db990f0 |
| 10 | 4 | WARNING | mobile-shots.js mask | BRANCH | email domain printed | FIXED | 2daeb6559 |
| 11 | 5 | WARNING | mobile-shots.js hits | SELF | key prefix, collapsed hits | FIXED | 5164e41fb |
| 12 | 5 | WARNING | mobile-shots.js comment | SELF | key coverage overstated | FIXED | 5164e41fb |
| 13 | 6 | WARNING | mobile-shots.js KEY_RE | BRANCH | AIza/xai keys | FIXED | 7f6882359 |
| 14 | 7 | WARNING | mobile-shots.js report | BRANCH | report names unscanned | FIXED | e7a827bb8 |
| 15 | 8 | WARNING | mobile-shots.js seed | BRANCH | recorded:false unchecked | FIXED | b254c1864 |
| 16 | 9 | WARNING | reason-grep count | BRANCH | stale after main moved | FIXED | rebase, 172 |
| 17 | 9 | WARNING | mobile-shots.js report | SELF | check before note complete | FIXED | 6fae985d5 |
| 18 | 9 | WARNING | leak checks | BRANCH | no control | FIXED | 6fae985d5 |
| 19 | 9 | CONVENTION | header / README | BRANCH | wording | FIXED | 6fae985d5 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] freePort pick-then-bind race (repo pattern) (iterations 3, 5, 10)
- [NIT] fixed settle sleeps after arrival (iteration 5)
- [NIT] overflow scan does not skip overflow:hidden descendants (iteration 5)
- [NIT] leak-control message text shared by convention, not a constant (iteration 8)
- [NIT] SHIPPED_EMAILS exempts every email shipped in index.html (iteration 1)

### Strengths (across all iterations)
- Each leak control must exit 3 AND show its own guard's message, so the wrong guard cannot satisfy it (all iterations)
- The sandbox refuses to start if an engine module loaded first, sets every root before the engine writers, and stays out of the named-home mode (iterations 3-10)
- Every screen waits for proof it arrived; the leak guard scans before and after each shot and the report, and reports hits by kind and length only (iterations 5-10)
