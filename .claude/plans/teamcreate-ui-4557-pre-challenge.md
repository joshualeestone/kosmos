---
pre_challenge: true
method: challenge-loop
branch: teamcreate-ui-4557
diff_hash: a4f3a6ce655b4077ab90452eb6d11a2f646b474ee91617a53e92dbf8bb2c2b79
validation: passed (Agent1s full suite at a89e45a4d, detached run "PASSED attempt 1"; 20eb5711d adds only origin/main plus a reason-grep count resolution, measured, and is covered by the PR's CI)
subdir_audit: passed
timestamp: 2026-09-30T09:09:12Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18
**Converged:** Yes (iteration 18 returned no new BLOCKER, WARNING or CONVENTION)
**Total findings (actionable):** 2 BLOCKERs and at least 15 WARNING/CONVENTIONs across 13 iteration commits
**Fixed:** all but the decided items below | **Deferred:** 1 (empty project on a first-member failure, plan) | **Asked:** 0

The loop ran in earlier sessions of mine (2026-09-29); the ledger survives in the iteration commits
("teamcreate-4557 -- address challenge-loop iteration N ..."). Iterations with no commit (6, 7, 11, 17)
returned only NITs or duplicates. The reviewer model per iteration was not recorded: **Reviewer model:
unknown** for each.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** unknown
- [BLOCKER] Try again pressed while a run was still making later members re-posted a member in flight --> FIXED: only waiting members are made (`creating` set before the first await); tcRun single-flight (9ab2d4223)

#### Iteration 2
- [WARNING] a team brief carrying a kosmos marker made later splices ambiguous (agent born without its reports/colleagues blocks) --> FIXED: the brief is neutralised; removing it reds the test (7a8a09d5e)

#### Iteration 3
- [WARNING] x3, one root cause: leaving the step RESET the team (dropped in-flight answers, failed rows, the watcher) --> FIXED: a started team stays live until every member is made and running (946a7c249)

#### Iteration 4
- Clean; two NITs taken: Create disabled while a resumed team is starting; a dropped create says it may have been made (afb6a6b41)

#### Iteration 5
- [WARNING] a team that can never finish kept tcLive true forever --> FIXED: another team waits only while something is in flight (905f8a219)

#### Iterations 6 and 7
- NITs or duplicates only; no commit.

#### Iteration 8
- [WARNING] one rule for a role this version lacks: refused by the catalogue's memberProblem; the unreachable 'own' fallback and a test that proved nothing removed (92c1f3ad8)

#### Iteration 9
- [CONVENTION] the brief-cap comment's unguarded claim deleted; the 32 KiB boundary test is the guard (f9f7cd33a)
- [WARNING] the empty project left when the first member fails --> DEFERRED: the plan chose no rollback

#### Iteration 10
- [WARNING] making the same team twice refused one taken seat per press --> FIXED: every taken seat named at once (ffa587bb7)

#### Iteration 11
- NITs or duplicates only; no commit.

#### Iteration 12
- [WARNING] a create that LANDED before the connection dropped left the row failed, and on the lead held every report forever --> FIXED: specs carries each member's session name (ffc73edb0)

#### Iteration 13
- [WARNING] defaultAgentFor in a deeper chart opened a middle manager instead of the top --> FIXED, tested with a deep chart (65f7756e2)

#### Iteration 14
- [BLOCKER] catalogue.memberInstructions returns the WHOLE file, so every real member (112 of 112) got its role text twice and a frozen copy of the team section --> FIXED: layer only the team section; measured before fixing (a2a57727b)

#### Iteration 15
- [CONVENTION] a JSDoc bound by position to the wrong function; the plan's slice headings --> FIXED (a9e23d685)

#### Iteration 16
- [WARNING] a file with only a team end marker was both CANNOT TELL and UNDELIVERED --> FIXED: reported once (51cbe2471)

#### Iteration 17
- NITs or duplicates only; no commit.

#### Iteration 18
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Converged** — no new actionable findings.

### After convergence (not review iterations)
- The first Mortals full run failed exactly one test (fixture discipline: hand-built cards), fixed in
  6509d3e1d ("the deep-chart defaultAgentFor test uses real fleet cards").
- Merges of origin/main (78a83c81d, a89e45a4d, 20eb5711d); the only conflicts were the
  browser-checks-reason-grep.test.js counts (main's plus this branch's one site, measured each time).
- render-teamcreate-4557.js on a merged tree (78a83c81d): 94 PASS, rc 0 ("ALL PASSED").

### Outstanding questions (ASKED)
None.

### Decided, not missed
- Not reachable from the product until #4556 calls openTeamCreate (the dropdown wiring is #4556's).
- The empty project left when the first member fails is kept (the plan chose no rollback).

### Strengths
- Iteration 14's BLOCKER was found by testing through the real catalogue once it landed, not the
  agreed-shape fixture that had hidden it in all 112 members.
