---
pre_challenge: true
method: challenge-loop
branch: subpick-3029
diff_hash: 01f93525bedae3bc74812d1f560798890858083b31fa6800f168975e4debeaf8
validation: failed (surface gate only; overridden per check, both gates green alone)
subdir_audit: passed
timestamp: 2026-10-13T13:25:00Z
iterations: 19
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 19, each a fresh blind reviewer, alternating sonnet (odd) and opus (even).
**Converged:** Yes. Iteration 15 converged first; the design shots then changed the screen, so rounds
16 to 19 reviewed that, and iteration 19 found nothing new.
**Validation:** the full suite on 8617766 passed every suite (node 19646 pass / 0 fail, shell shards
232/232, the other suites 0 failures) and went red on the browser-check surface gate (#2518) only: three
checks whose tokens sit on changed lines (render-subback-4586, render-allagents-4812,
render-phone-offline-718). None is affected; a per-check `Browser-check-surface:` trailer says why, and
both gates then exit 0 alone. The full suite was not re-queued (four hours); CI runs it.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet. **Self-generated:** 0.
- [WARNING] engine/tasks.js projectPathOf detached allTasks' docblock --> FIXED (591f9eb)
- [WARNING] engine/tasks.js dead parentName fallback, and a comment claiming it --> FIXED (591f9eb)
- [WARNING] web/index.html projHint chain from PROJECTS --> DEFERRED: that arm runs only with no rows

#### Iteration 2
**Reviewer model:** opus. **Self-generated:** 1.
- [WARNING] web/index.html Tasks title and back label used the bare name --> FIXED (c068322)
- [WARNING] web/index.html settings picker's archived parent label bare --> FIXED (c068322)
- [NIT] plan claimed the engine walk equals pjAncestry --> FIXED, claim deleted (c068322)

#### Iteration 3
**Reviewer model:** sonnet. **Self-generated:** 1.
- [WARNING] engine test fixture put parentName on a stored record --> FIXED (556e12b)
- [WARNING] parent-picker order unguarded --> DEFERRED: mutation (sort back to PJ_SORT) fails the browser arm
- [WARNING] rows vs PROJECTS race on rename --> DEFERRED: the same shape projectName has on main

#### Iteration 4
**Reviewer model:** opus. **Self-generated:** 0.
- [WARNING] web/index.html row project button and aria-labels bare under Group by: Status --> FIXED (bf04da6)
- [WARNING] web/index.html search ignored ancestors --> FIXED (bf04da6)

#### Iteration 5
**Reviewer model:** sonnet. **Self-generated:** 1.
- [WARNING] web/index.html row chain spelled four times --> FIXED, tskChainOf (fc5249a)
- [WARNING] no node test for pjChainCompare --> FIXED (fc5249a); writing it disproved my stated reason
  ("Alpha 2" never misorders a joined sort; "Alpha - old" does): fixture, comment and plan corrected

#### Iteration 6
**Reviewer model:** opus. **Self-generated:** 1.
- [WARNING] web/index.html chains rebuilt per sort comparison --> FIXED, pjSortByChain (6e7db9c)
- [CONVENTION] plan test counts stale --> FIXED, counts removed (6e7db9c)

#### Iteration 7
**Reviewer model:** sonnet. **Self-generated:** 0.
- [WARNING] search over-match had no negative case --> DEFERRED: the exact-set assertion excludes Book A

#### Iteration 8
**Reviewer model:** opus. **Self-generated:** 1.
- [WARNING] web/index.html group sort rebuilt chains per comparison --> FIXED (d0ad33a)
- [NIT] aria-labels read the › mark aloud --> FIXED, pjChainSpoken (d0ad33a)

#### Iteration 9
**Reviewer model:** sonnet. **Self-generated:** 0.
- [NIT] pjChainOf gave undefined for a nameless project --> FIXED (c06cab6)

#### Iteration 10
**Reviewer model:** opus. **Self-generated:** 0.
- [WARNING] no test of a subproject row's checkbox and Not built yet labels --> FIXED (d256d52)
- [WARNING] project-door branch untested --> FIXED (d256d52)
- [WARNING] bulk-close failure line untested --> DEFERRED: needs a stubbed refused bulk write for one label

#### Iteration 11
**Reviewer model:** sonnet. **Self-generated:** 1.
- [WARNING] tskChainOf comment claimed one array everywhere --> FIXED, claim deleted (17ff50b)

#### Iteration 12
**Reviewer model:** opus. **Self-generated:** 0.
- [WARNING] web/index.html Project: select grew past a phone (525 px at 390) --> FIXED (9493aad)
- [WARNING] browser arm had no layout check --> FIXED (9493aad)
- [CONVENTION] ntChoices comments said name order --> FIXED (9493aad)

#### Iteration 13
**Reviewer model:** sonnet. **Self-generated:** 1.
- [WARNING] row-shape consumers, archived in PROJECTS --> DEFERRED: no test pins the keys; /api/projects returns archived

#### Iteration 14
**Reviewer model:** opus. **Self-generated:** 1.
- [WARNING] closed select loses the own name; ellipsis claim unseen in WebKit --> FIXED (0f8ce3b): shots in
  both engines; options own name first; a WebKit-only 140 px sideways scroll found and fixed

#### Iteration 15
**Reviewer model:** sonnet. **Self-generated:** 0.
**Converged** (all findings duplicates). The design shots that followed changed the screen.

#### Iteration 16
**Reviewer model:** opus. **Self-generated:** 0.
- [WARNING] a WebKit that failed to launch read as green --> FIXED, now a failure (b371ea4)
- [WARNING] dialog pickers' fit unchecked --> FIXED, measured in range and guarded in WebKit (b371ea4)

#### Iteration 17
**Reviewer model:** sonnet. **Self-generated:** 0.
- [WARNING] a filtered snapshot would truncate paths --> DEFERRED: the only caller passes projects.readAll()

#### Iteration 18
**Reviewer model:** opus. **Self-generated:** 0.
**No BLOCKER, WARNING or CONVENTION.** Three NITs taken anyway (8617766): the open count beside the own name,
a fresh page per dialog check, WebKit honours HEADED.

#### Iteration 19
**Reviewer model:** sonnet. **Self-generated:** 0.
**Converged**: both warnings repeat earlier deferrals; no new finding.

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- Chain order is segment by segment, with a control proving the rejected joined sort misorders.
- The engine path comes from the same read as the rows, is loop-safe and additive.
- The browser arm drives every surface through the page's own painters, light and dark, and the WebKit
  arm is mandatory; each new assertion was shown to fail against main or a mutant.
