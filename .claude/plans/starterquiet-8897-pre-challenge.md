---
pre_challenge: true
method: challenge-loop
branch: starterquiet-8897
diff_hash: 8089e797b924e0d1e94a546f6d576a627cd4fd525970f3a89808d8f2f44655d5
validation: local: every page-reading and browser-check meta test (web.*, browser-checks-*, tools.browser-checks-*, tools.mobile-shots-*), engine/starter-8832 and starter-page-8897, fixture-discipline and engine.reachable: 482 files, 3,993 of 3,993; the 16 engine/projects* files 329 of 329 (3 skipped) and 7 server.project* files 231 of 231 (earlier head, engine unchanged since); docs/browser-checks/render-starter-empty-8897.js 36 of 36, run green by the gated runner at 638fb924d8. 8 mutations red. Design shots in ~/work/design-shots/kosmos-8897/, design read by Mona Lisa (taken). The full suite runs on the PR's CI.
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-22T16:03:20Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 fresh blind reviewers, plus Mona Lisa's design read.
**Converged:** Yes, by measurement after round 4. Rounds 2 to 4 each found one existing test or rule the branch broke (an unwired check, an unindexed check and a route outside the #6022 try form, a two-arm pin). After round 4 every test of that class (each that reads web/index.html or docs/browser-checks) was run: 3,993 of 3,993. No round found a defect in the behaviour.
**Total actionable findings:** 3 BLOCKERs (all repo tests the branch broke), 4 WARNINGs, 9 NITs
**Fixed:** every BLOCKER and WARNING but one deferral, most NITs | **Accepted:** listed below | **Asked:** 0

### Per-Iteration Breakdown

#### Design read (Mona Lisa)
- Shorter sentence --> TAKEN. "Made by" line in the shot --> FIXED (the shot's starter is made by Kosmos, as the real one; the real one shows no such line). Busy fixture room --> explained, comment added.

#### Iteration 1
- [WARNING] "its agents are waiting" on a starter with no agent --> FIXED (its own sentence)
- [WARNING] the Tasks view and the iPhone app still read as an ordinary empty project --> DEFERRED (plan: a filter across projects, and a separate app and release lane)
- NITs: the guard comment's case, a rewritten brief, a lookalike-name control --> FIXED; the browser check is manual --> became BLOCKER in round 2

#### Iteration 2
- [BLOCKER] the browser check ran nowhere --> FIXED (gated.txt; the wiring test fails without it)

#### Iteration 3
- [BLOCKER] not indexed in the README; the shots route outside the #6022 try form --> FIXED (README row; the file's editProjects helper)
- [WARNING] --remote and POST through the shots route --> FIXED by editProjects (GET only)
- NIT: one agent reads plural --> FIXED

#### Iteration 4
- [BLOCKER] web.room-761.test.js pinned the empty-Tasks statement as two arms --> FIXED (read whole, same strength; a blanked arm still turns it red)
- NIT: the seed-mark scan excluded all of docs/browser-checks --> FIXED (mobile-shots.js only)

### Accepted, and why
- A sentence in the empty column, not a badge on the project card: Josh's #4730 rule (badges only when something runs).
- "Its agents are waiting" for a paused starter or stopped agents: an invitation to the person, true of what happens when they give work.
- The scoped Tasks view and the iPhone app: deferred, as above.
