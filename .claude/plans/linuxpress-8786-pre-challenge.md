---
pre_challenge: true
method: challenge-loop
branch: linuxpress-8786
diff_hash: 4d57fdf4257754275c53efcfc0be60aa0b981a87f78179c03f5f9be072f20781
validation: passed (Mortals, full suite, hash 4d57fdf42577, 2026-11-20T08:00:46Z)
subdir_audit: passed
timestamp: 2026-11-20T08:01:16Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No: stopped by the 8-round review rule (a standing operating rule, not a user stop) with no BLOCKER open. Round 8 still raised WARNINGs (one fixed, two duplicates of deferrals); its fixes were not reviewed by a further round.
**Total findings:** 0 BLOCKERs, 25 WARNINGs, 8 CONVENTIONs, NITs as listed
**Fixed:** 27 | **Deferred:** 6 | **Asked (awaiting user):** 0

**6.0 deviation, stated:** the local validation helper was not run during the loop (Agent1s allows one heavy run at a time and it was taken). Each round ran the touched suites (engine/update.linux-press-8786, update.linux-manual-7935, update.linux-family-7281, web.linux-update-7935, update.win32-570, update.win32-check, update.test, platform.test; 103 tests at the end) and the full-suite-only guards (engine.reachable, fixture-discipline, tools.every-test-runs from the worktree, check-frozen-roots), with mutants for each new check. The full suite then ran on Mortals for this exact diff: 30172 node tests, 29559 pass, 0 fail, 613 skipped, 0 cancelled; shell shards 84, 75, 79, 80 all passed; the 19 #8786 tests ran and passed; status clean.

**Weakest premise, carried to after merge:** the board's own spawn (with KOSMOS_UPDATE_BY_BOARD=1) behaves on a real Linux box as the measured `kosmos update` run did. Measured both ways on Ubuntu 24.04 for the verb (kosmos#8786 comment 7030766599); the board's own press is not. A failure there is a revert.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 4 WARNINGs, 3 NITs
**Self-generated:** 0 (nothing committed by the loop yet)
- [WARNING] engine/update.js: the seam replaced the whole reader, so the real KillMode comparison was untested --> FIXED (987166a959): readers seam one level down, comparison tested
- [WARNING] engine/update.js: systemctl spawnSync twice per press on the event loop --> FIXED (987166a959): one reading serves a press, 2 s bound
- [WARNING] update.linux-press-8786.test.js: the beginInstall predicate accepted any throw --> FIXED (987166a959): asserts LIVE_EXECUTION_REFUSED
- [WARNING] the #7935 suites depended on the real reading --> FIXED (987166a959): pinned with setLinuxPress(() => false)
- NITs: test title, memo test, unit-name gap comment --> FIXED (987166a959)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] engine/update.js: the unit name derived from the home could miss the real unit --> FIXED (d01096ba8d): named from the cgroup line
- [WARNING] spawnSync on the event loop --> DEFERRED: duplicate of iteration 1, bounded at 2 s and fails safe
- [WARNING] the end-to-end press is unmeasured --> DEFERRED: the live-execution gate stops a test before /bin/sh by design; measured after merge
- NITs: v1 comment, memo comment, test title --> FIXED (d01096ba8d)

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 3 WARNINGs, 3 CONVENTIONs, 3 NITs
**Self-generated:** 2 (the cgroup comment and the test this loop wrote)
- [WARNING] the real-reader test depends on where it runs --> FIXED (bafd160fb5): skips inside a kosmos-board unit
- [WARNING] no test crosses the engine to the page or route --> FIXED in part (bafd160fb5): an engine-to-page test; the route DEFERRED to the real-box measurement
- [WARNING] the Linux refusal said the platform can never update --> FIXED (bafd160fb5)
- [CONVENTION] the #570 doc block --> FIXED (bafd160fb5)
- [CONVENTION] "v1 or hybrid" comment --> FIXED (bafd160fb5): pure v1
- [CONVENTION] web/index.html comments --> DEFERRED: a web/ edit needs its own browser-check gate; follow-up on the card
- NITs: plan count, failed-read TTL --> FIXED (bafd160fb5, 779e0d310f); duplicate SELF_INSTALL assertion kept

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] systemctl asked even with nothing on offer --> FIXED (2a60b7ddba)
- [WARNING] a hung systemctl re-asked every 30 s --> FIXED (2a60b7ddba): a timeout keeps the full window
- [WARNING] the end-to-end press --> DEFERRED: duplicate
- [CONVENTION] nothing marks the unattended gate --> FIXED (2a60b7ddba): a comment at autoInstallWouldStart
- NITs: node:child_process --> FIXED (2a60b7ddba); a thrown reader cached 5 min --> kept

#### Iteration 5
**Reviewer model:** opus (default)
**New findings:** 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] a press could race a typed `kosmos update` --> FIXED (43f8d065ca): a fresh foreign install.started refuses, in the route and in beginInstall before the single-flight (the first fix was wrong; its own test caught it)
- [WARNING] a system unit of the same name --> FIXED (43f8d065ca): must sit under user@<uid>.service
- [WARNING] a systemd without show --value --> DEFERRED: no supported distro; moot after iteration 7 (no --value)
- [WARNING] no route test --> DEFERRED: duplicate
- [CONVENTION] updateCommand doc --> FIXED (43f8d065ca)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 2 NITs
**Self-generated:** 2 (wordings this loop wrote)
- [WARNING] the refusal claimed an install was running when a crashed run leaves the same marker --> FIXED (d6d23c6761)
- [WARNING] systemctl retry stall --> DEFERRED: duplicate
- [WARNING] the beginInstall throw untested --> DEFERRED: not an issue, the test asserts it
- NITs: comment reflow, refusal wording stronger than known --> FIXED (d6d23c6761)

#### Iteration 7
**Reviewer model:** opus (default)
**New findings:** 2 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** 1 (a wording this loop wrote)
- [WARNING] a board started by hand inside the cgroup would be offered the press --> FIXED (c9ef8b1467): MainPID must be this process
- [WARNING] install/kosmos cmd_update's comment is stale --> DEFERRED: out of the plan's scope; follow-up on the card
- [CONVENTION] platform.js canSelfInstall doc, server.js payload comment --> FIXED (c9ef8b1467)
- NITs: "never shows both" softened, refusal for no service, resetCache clears the memo --> FIXED (c9ef8b1467); lastAttempt on the race throw kept

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 2 NITs
**Self-generated:** 1 (a wording this loop wrote)
- [WARNING] the board's own interrupted press leaves the marker --> FIXED (11e3fbd8b9): the sentence names an interrupted run
- [WARNING] the end-to-end press --> DEFERRED: duplicate
- [WARNING] a stale button then a 409 --> DEFERRED: fail-closed by design
- NITs: ENOENT treated as lasting, comment re-wrap --> FIXED (11e3fbd8b9)
**Stopped by the 8-round rule.**

### Final Ledger (deferrals only; every other finding above is FIXED at the commit named)

| # | Iter | Category | Origin | Description | Status | Resolution |
|---|------|----------|--------|-------------|--------|------------|
| D1 | 2 | WARNING | BRANCH | the press end to end on a real box, and POST /api/update on Linux | DEFERRED | measured after merge; a failure is a revert |
| D2 | 2 | WARNING | BRANCH | spawnSync on the event loop | DEFERRED | bounded 2 s, one per press, fails safe |
| D3 | 3 | CONVENTION | BRANCH | web/index.html comments (~20298, ~25948) | DEFERRED | web/ gate cost; follow-up on #8786 |
| D4 | 5 | WARNING | BRANCH | systemd without show --value | DEFERRED | moot: --value no longer used |
| D5 | 7 | WARNING | BRANCH | install/kosmos cmd_update comment | DEFERRED | out of scope; follow-up on #8786 |
| D6 | 8 | WARNING | BRANCH | stale button then a 409 | DEFERRED | fail-closed by design |

### Outstanding questions
None.

### NITs kept
- A duplicate SELF_INSTALL assertion (the control after it carries the test).
- A thrown reader is cached for the full window (a missing /proc is permanent).
- The race throw in beginInstall records no lastAttempt (the route answers 409 first).

### Strengths
- The press reads the running system (cgroup, KillMode, MainPID), not the unit file, and every unclear case keeps the command.
- The unattended install stays off on Linux, pinned by a test with a control that can see an automatic install.
- The safety condition was measured both ways on a real Ubuntu box before any code.
