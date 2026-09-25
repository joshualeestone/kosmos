---
pre_challenge: true
method: challenge-loop
branch: tasks-tab-3559
diff_hash: db161d6057b4abdfc411ca428caee5c02c28b6ebe8eea6b1d3d6691beee64f40
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T07:59:29Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 blind reviewer passes, plus the 6.0 validation pass (full-suite reds fixed before iteration 1)
**Converged:** Yes (iteration 10, Sonnet: NO FINDINGS)
**Total findings:** 25 reviewer findings (0 BLOCKERs, 21 WARNINGs, 4 CONVENTIONs) plus 6 synthetic validation BLOCKERs from 6.0, and the NITs below
**Fixed:** 31 | **Deferred:** 0 | **Asked (awaiting user):** 0

Shas are the post-rebase ids (branch rebased onto origin/main at 02:40 CDT 2026-09-25; the only
conflict was the no-URL loop line in tools/browser-checks.sh, resolved by taking main's line and
re-adding render-tasks-view-3559). Iterations 1 to 8 ran on the pre-rebase branch; iteration 9 and
10 ran on the rebased diff.

### Per-Iteration Breakdown

#### Validation pass (6.0)
**New findings:** 6 synthetic BLOCKERs from the full suite
**Self-generated:** 0
- [BLOCKER] web/index.html tskAgentName: read displayName, which fleet cards do not carry --> FIXED (0cd181c6, uses `name`)
- [BLOCKER] engine/tasks.state-3559.test.js: last-activity timing assertion --> FIXED (0cd181c6)
- [BLOCKER] web/index.html: --tsk-c undefined for a row with no state --> FIXED (0cd181c6, default token)
- [BLOCKER] web/index.html: combined uncap selector broke a pinned guard --> FIXED (0cd181c6, own rule)
- [BLOCKER] web.layout-picker.test.js: rail-head guard refused the Tasks button --> FIXED (0cd181c6, button in .lead, guard widened for exactly one)
- [BLOCKER] web.consolidated-774.test.js pinned paintPjNone and a 15-line window --> FIXED (a0b52483 line, single-line hide loop)

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs, 2 CONVENTIONs
**Self-generated:** 0
- [WARNING] server.js POST /api/tasks/close: a roster read and agent sync per task --> FIXED (a0b52483, one roster read, one sync per agent)
- [WARNING] server.js GET /api/tasks: every caller paid the claim join and transcript reads --> FIXED (a0b52483, gated on ?view=tasks)
- [WARNING] web/index.html: consolidated rail button flipped out of the consolidated layout --> FIXED (a0b52483, openConsolidatedTasks opens in the display column like #2842)
- [WARNING] web/index.html asbScreen: setup guide told the wrong screen on Tasks --> FIXED (a0b52483)
- [WARNING] web/index.html: repaint lost keyboard focus --> FIXED (a0b52483)
- [WARNING] web/index.html: selection covered rows hidden by a filter --> FIXED (a0b52483, pruned to visible)
- [CONVENTION] web/index.html: stale error message survived a successful reload --> FIXED (a0b52483)
- [CONVENTION] tests that could not fail (dropdown visibility read computed display) --> FIXED (a0b52483, getClientRects)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs
**Self-generated:** 1
- [WARNING] web/index.html: background board-tick repaint stole focus --> FIXED (9289a4e8)
- [WARNING] plan claimed search fields that do not exist yet --> FIXED (9289a4e8)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION
**Self-generated:** 1
- [WARNING] web/index.html: focus restore not container-scoped; no focus target after bulk close --> FIXED (ceb1f9c5)
- [WARNING] web/index.html openConsolidatedTasks: Plus chrome not synced --> FIXED (ceb1f9c5)
- [WARNING] server.js: closed tasks paid transcript reads --> FIXED (ceb1f9c5)
- [CONVENTION] CLAUDE.md Where-to-Find-Things row did not name ?view=tasks --> FIXED (ceb1f9c5)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING
**Self-generated:** 1
- [WARNING] server.js bulk close: projects.get claim join per item --> FIXED (4a7d76fb, one readAll snapshot; spy test with control)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION
**Self-generated:** 2
- [WARNING] web/index.html tskPaint: ticks pruned after the no-match early return, so hidden rows stayed selected --> FIXED (ec1ee8ad, control)
- [WARNING] server.js bulk close: note written before the close, so a failed close left a stray note --> FIXED (ec1ee8ad, close then note)
- [WARNING] web/index.html: crumb focus lost when its control vanished --> FIXED (ec1ee8ad, fallback chain)
- [CONVENTION] plan's claims out of date; 'closed' count included earlier closes --> FIXED (ec1ee8ad)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs
**Self-generated:** 1
- [WARNING] plan's Decisions bullet still said note-then-close --> FIXED (5dcf78d1)
- [WARNING] web/index.html: search results not announced to screen readers --> FIXED (5dcf78d1, #tsk-found live region)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs (plus one decision)
**Self-generated:** 0
- [WARNING] engine/tasks.js lastActivityOf: part closes did not count as activity --> FIXED (0ec81c76)
- [WARNING] web/index.html: Clear dropped focus --> FIXED (0ec81c76, focuses search)
- DECISION: archived projects left out of the view (projectArchived) --> 0ec81c76, recorded in the plan

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 actionable (3 NITs)
**Self-generated:** 0
Converged on the pre-rebase branch. The rebase changed the diff, so the loop continued.

#### Iteration 9 (rebased diff)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs
**Self-generated:** 1
- [WARNING] server.js GET ?view=tasks: a throwing claim join left assigned rows reading "not started" as a fact --> FIXED (f488b20f, claimed:null with the reason; test with planted throw and control; mutation red)
- [WARNING] server.js GET ?view=tasks: claims and transcripts read for archived projects the page discards --> FIXED (f488b20f, skipped server-side; spy test; mutation red)
- [NIT] web/index.html tskMatches: "#1" matched #12 --> FIXED anyway (f488b20f, exact #N; mutation red)
- [NIT] web.tasks-view-3559.test.js: left-bar guard blind to an inset box-shadow bar --> FIXED anyway (f488b20f, with control)

#### Iteration 10 (rebased diff)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | server.js bulk close | BRANCH | roster read + sync per task | FIXED | a0b52483 |
| 2 | 1 | WARNING | server.js GET /api/tasks | BRANCH | costly fields for every caller | FIXED | a0b52483 |
| 3 | 1 | WARNING | web/index.html rail button | BRANCH | consolidated flip-out | FIXED | a0b52483 |
| 4 | 1 | WARNING | web/index.html asbScreen | BRANCH | wrong screen on Tasks | FIXED | a0b52483 |
| 5 | 1 | WARNING | web/index.html repaint | BRANCH | focus lost | FIXED | a0b52483 |
| 6 | 1 | WARNING | web/index.html selection | BRANCH | hidden rows selected | FIXED | a0b52483 |
| 7 | 1 | CONVENTION | web/index.html tskLoad | BRANCH | stale error kept | FIXED | a0b52483 |
| 8 | 1 | CONVENTION | render-tasks-view-3559.js | BRANCH | test that could not fail | FIXED | a0b52483 |
| 9 | 2 | WARNING | web/index.html tick | SELF | background repaint stole focus | FIXED | 9289a4e8 |
| 10 | 2 | WARNING | plan | BRANCH | search claim | FIXED | 9289a4e8 |
| 11 | 3 | WARNING | web/index.html focus | SELF | not container-scoped | FIXED | ceb1f9c5 |
| 12 | 3 | WARNING | web/index.html openConsolidatedTasks | BRANCH | Plus chrome | FIXED | ceb1f9c5 |
| 13 | 3 | WARNING | server.js GET | BRANCH | closed tasks read transcripts | FIXED | ceb1f9c5 |
| 14 | 3 | CONVENTION | CLAUDE.md | BRANCH | row missing ?view=tasks | FIXED | ceb1f9c5 |
| 15 | 4 | WARNING | server.js bulk close | SELF | projects.get per item | FIXED | 4a7d76fb |
| 16 | 5 | WARNING | web/index.html tskPaint | SELF | prune after early return | FIXED | ec1ee8ad |
| 17 | 5 | WARNING | server.js bulk close | SELF | note before close | FIXED | ec1ee8ad |
| 18 | 5 | WARNING | web/index.html crumb | BRANCH | focus fallback | FIXED | ec1ee8ad |
| 19 | 5 | CONVENTION | plan / server.js | BRANCH | claims, closed count | FIXED | ec1ee8ad |
| 20 | 6 | WARNING | plan | SELF | close order bullet | FIXED | 5dcf78d1 |
| 21 | 6 | WARNING | web/index.html search | BRANCH | no live region | FIXED | 5dcf78d1 |
| 22 | 7 | WARNING | engine/tasks.js lastActivityOf | BRANCH | part closes ignored | FIXED | 0ec81c76 |
| 23 | 7 | WARNING | web/index.html Clear | BRANCH | focus dropped | FIXED | 0ec81c76 |
| 24 | 9 | WARNING | server.js GET ?view=tasks | SELF | unreadable claims read as fact | FIXED | f488b20f |
| 25 | 9 | WARNING | server.js GET ?view=tasks | BRANCH | archived projects paid for | FIXED | f488b20f |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] server.js bulk close: "already closed" decided from one snapshot, so a single close in the same instant is closed again and counted as closed (iteration 9; recorded in the plan)
- [NIT] server.js GET ?view=tasks: a HEAD request runs the full path (iteration 9)
- [NIT] 207 is a new status shape for this server (iteration 8)
- [NIT] asbScreen consolidated detection only for Tasks (iteration 8)
- [NIT] archived claims computed then dropped (iteration 8; since fixed in f488b20f)

### Strengths (across all iterations)
- State is derived by the engine (taskState), never by the page; only provable groups exist (iterations 1, 10)
- Bulk close reuses the existing screen-only and cross-site guards, with tests for both token paths (iterations 9, 10)
- Every guard test carries a planted control that proves it can fail (iterations 5, 9, 10)
