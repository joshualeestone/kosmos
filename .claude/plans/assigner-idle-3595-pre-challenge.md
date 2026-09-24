---
pre_challenge: true
method: challenge-loop
branch: assigner-idle-3595
diff_hash: c4e131982773c02499ef5c07788b4b79a238f133e2d4417a49e5c5131ff362f8
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T18:45:38Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (blind reviews in iterations 1 to 4; the 6.0 validation red was contention, see below)
**Converged:** Yes. Iteration 4 returned no NEW actionable finding: its one WARNING (default ON reaches every install that never set it) is ledger #7, a decision recorded in the plans and on #3595. 6j passed on HEAD c9eb5f4b (clean validation record for diff hash c4e13198).
**Total findings:** 15 actionable (1 BLOCKER, 10 WARNINGs, 4 CONVENTIONs) plus 13 NITs
**Fixed:** 14 | **Deferred:** 1 | **Asked (awaiting user):** 0

Validation notes: the 6.0 run (load 9 to 19, other agents' suites on the box) had 43 timeout reds in 13 files this branch does not change; all 240 of those tests passed together afterwards on the changed code, and the one shell red (test-cut-rerun-guard) passed alone. The iteration-1 run's only red was tools/test-kosmos-addr-reclaim-3079.sh (a spawned listener's pid race), 12/12 alone, in install/ code this branch does not touch. The iteration-2 and iteration-3 runs were fully clean (8602 and 8605 pass, 0 fail, shell tests clean).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 6 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [CONVENTION] .claude/plans/: no plan file matched the branch name --> FIXED (82ad430a): branch sub-plan pointing at the card plan
- [WARNING] server.js givePart / engine/assigner.js: a part could be given while the agent was never told (budget spent or COULD_NOT), and the agent was then never considered again --> FIXED (11c2ddb4): the Assigner's pane line is not budget-gated and a COULD_NOT takes the assignment back; tested on the real deliver refusal
- [WARNING] shared valves: the Assigner drew on the agents' 12/hour parts valve and heard budget and the refusal text blamed agents --> FIXED (11c2ddb4): provenance 'assigner', neither budget charged; control proves the valve count sees a process write
- [WARNING] server.js runner: no test through the real write path --> FIXED (11c2ddb4): server.assigner-give-3595.test.js drives the real givePart
- [WARNING] read-then-write race could move a part off a person --> FIXED (11c2ddb4): tasks.assignPart onlyIfFree, checked inside the write; proven by removal
- [WARNING] web/index.html saveAssigner (and the Recommender's): the failure reason was wiped by the repaint --> FIXED (11c2ddb4): repaint keeps the message; tests fail on the old page
- [WARNING] default ON premise understated ("only sets who") --> DEFERRED as a code change: Splinter's 2026-09-24 11:08 default stands (Assigner ON); the real behaviour (it types into panes under bypass permissions) is now stated in the sub-plan and on #3595 so Josh rules on it
- [BLOCKER] (found by running the gate) browser-check surface gate matched token 'msg' (render-agentdm-3414.js) --> FIXED (d23d497b): every hit is the Settings asg-msg id or a local variable; per-check trailer; gate rc=0, prior commit rc=1
- [NIT] runner log said "told" on a failed line (fixed); staleness window vs idle window (documented); label says goals (kept, #2619 wording); multi-part rule (documented)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 2 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] engine/assigner.js hasOpenWork: open work in an ARCHIVED project was invisible, so a busy agent could read idle --> FIXED (6eeb2af4): open work counts across all projects, picking stays live-only; proven by reverting
- [CONVENTION] engine/assigner.js constants lacked a why-comment --> FIXED (6eeb2af4)
- [CONVENTION] engine/assigner.js the '9999-99-99' sentinel was a bare literal --> FIXED (6eeb2af4): NO_DUE_DATE

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 5 NITs
**Self-generated:** 1 of the above (the takeback line was written in 11c2ddb4; fixed in code, not prose)
- [WARNING] server.js PUT /api/assigner-setting had no screen check though the Assigner now types into panes --> FIXED (c9eb5f4b): advisory isViaScreen refusal as the Recommender's; both arms tested; proven by removal
- [WARNING] server.js runner glue untested --> FIXED (c9eb5f4b): the composition is assigner.tick with injected reads, tested on real reads
- [WARNING] server.js takeback could clear a part somebody took during the paste --> FIXED (c9eb5f4b): onlyIfWho inside the write; proven by removal
- [NIT] hint omits the commitments condition (fixed); master plan said live-only open work (fixed); refund uniqueness assumption (stated at the refund); label says goals (kept); a refused onlyIfFree still writes the same record (left)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (1 WARNING deduplicated to ledger #7), 2 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings; 6j passed.
- [NIT] engine/assigner.js ageKey falls back to the task number (a different unit) when createdAt is unparseable; dead today since tasks.create always stamps createdAt (left)
- [NIT] engine/assigner-setting.js opening sentences still describe goals-to-tasks (phase 3); the SCOPE paragraph below is correct (left for phase 3)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | no branch-named plan | FIXED | 82ad430a |
| 2 | 1 | WARNING | server.js givePart | BRANCH | given but never told | FIXED | 11c2ddb4 |
| 3 | 1 | WARNING | server.js givePart | BRANCH | shared valves charged and blamed | FIXED | 11c2ddb4 |
| 4 | 1 | WARNING | server.js runner | BRANCH | no real-path test | FIXED | 11c2ddb4 |
| 5 | 1 | WARNING | engine/tasks.js assignPart | BRANCH | read-then-write race | FIXED | 11c2ddb4 |
| 6 | 1 | WARNING | web/index.html saveAssigner | BRANCH | failure reason wiped | FIXED | 11c2ddb4 |
| 7 | 1 | WARNING | engine/assigner-setting.js | BRANCH | default ON premise | DEFERRED | Splinter 11:08 decision; real behaviour recorded on #3595 |
| 8 | 1 | BLOCKER | web/index.html (gate #2518) | BRANCH | surface gate token 'msg' | FIXED | d23d497b |
| 9 | 2 | WARNING | engine/assigner.js hasOpenWork | BRANCH | archived open work ignored | FIXED | 6eeb2af4 |
| 10 | 2 | CONVENTION | engine/assigner.js constants | BRANCH | no why-comment | FIXED | 6eeb2af4 |
| 11 | 2 | CONVENTION | engine/assigner.js dueKey | BRANCH | bare sentinel | FIXED | 6eeb2af4 |
| 12 | 3 | WARNING | server.js assigner PUT | BRANCH | no screen check | FIXED | c9eb5f4b |
| 13 | 3 | WARNING | server.js runner | BRANCH | glue untested | FIXED | c9eb5f4b |
| 14 | 3 | WARNING | server.js givePart takeback | SELF | takeback could clear a person's part | FIXED | c9eb5f4b |
| 15 | 4 | WARNING | engine/assigner-setting.js | BRANCH | default ON reaches existing installs | DUPLICATE of #7 | as #7 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- runner log "told" on a failed line (iteration 1; fixed)
- commitments stale at 30 min vs 20 min idle, so it may fire rarely (iteration 1; documented)
- label still says goals (iterations 1, 3; kept as #2619 shipped it, recorded on #3595)
- multi-part tasks give only the first open part (iteration 1; documented)
- hint omitted the commitments condition (iteration 3; fixed)
- master plan said live-only open work (iteration 3; fixed)
- refund uniqueness assumption (iteration 3; stated at the refund)
- a refused onlyIfFree still writes the same record (iteration 3; left)
- ageKey unit mismatch in a dead fallback (iteration 4; left)
- assigner-setting opening sentences describe phase 3 (iteration 4; left for phase 3)

### Strengths (across all iterations)
- One givePart shared by the route and the Assigner, so the valve, assign, tell and re-sync sequence exists once (every iteration)
- Pure step / runOnce / tick with every read injected (iterations 1 to 4)
- Tests on real cards, commitments, projects and tasks; each guard proven load-bearing by removing it (iterations 1 to 4)
- Both race windows (read-then-write, and during the paste) closed inside the write and tested for real (iterations 3, 4)
