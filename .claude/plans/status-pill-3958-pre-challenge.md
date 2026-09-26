---
pre_challenge: true
method: challenge-loop
branch: status-pill-3958
diff_hash: ee87237643a5b9db0bfebef13c9404f7b0ca2ac79c0e8f09b956a09d675bc6d7
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T22:56:54Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16
**Converged:** Yes (iteration 16, sonnet: nothing actionable, with mutations confirming the tests catch
regressions)
**Findings:** iterations 1-4 are tallied below as originally recorded (21: 2 BLOCKERs, 8 WARNINGs,
11 NITs). Iterations 5-16 are recorded per iteration in .claude/plans/status-pill-3958.md and in each
"address challenge-loop iteration N" commit, not as a per-severity tally, so no invented counts
are given for them; they include 2 BLOCKERs (a swarm face with no ring or dot, iteration 6; a
trust-stuck member's green dot, iteration 12), all fixed.
**Deferred:** 1 (the device-ask rows, carded #3978) | **Asked:** 0

The branch carries #3958 (the agent page's header follows the poll), #3966 (threads are not rebuilt
when only a relative time ticks) and #3991 (the tab view's members get the memory ring and presence
dot), done together at Splinter's direction.

Validation: validation_log_run_or_skip PASSED at hash ee87237643a5 (after iteration 16); subdir
CLAUDE.md audit rc 0. Browser checks run on the final tree: render-agent-pill-3958,
render-member-ring-3991, render-thread-steady-3966, render-unread-edge-3743 (all pass).
Reviewer models alternated opus/sonnet.

#### Iterations 5 to 16 (summary; details in the plan)
- 5-8: the #3991 ring and dot added; the swarm face (BLOCKER, 6); the dot reads boardMods; harness
  preludes.
- 9: a climbing reading patches the ring arc in place (no column rebuild).
- 10: a stale working sample dropped whole; the trust dot reads needsTrust; rings paired by agent.
- 11: the Start button follows the poll; guarded text writes; unit pins for ring shape/refreshWhens.
- 12: BLOCKER: a trust-stuck member's green dot --> hollow unsure dot, against the real CARD_ST.
- 13: the Start receipt; thin rings in warn/high; the rail's needstrust dot hollow too.
- 14: the receipt clears on a real stop; dot rules by specificity.
- 15: a quick exit no longer strands Start; a stale Start line is cleared.
- 16: nothing actionable. Converged.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html:29795 - server.test.js's detail-badge test slices the pill block onto fake elements with no `dataset`; it threw --> FIXED (874ac31a4: dataset on the fake)
- [WARNING] web/index.html:19594 - pill ignored paintBusy's stale-working rule, so pill and DM line could split --> FIXED (874ac31a4: shared workingSampleIsStale)
- [WARNING] web/index.html:29310 - remembered marker read CURRENT (open-time card) while the pill is live --> FIXED (874ac31a4: reads the latest card)
- [WARNING] render-agent-pill-3958.js:108 - only idle/working flips covered --> FIXED (874ac31a4: needs_you flip compared to the grid card's state word)
- [NIT] markStateRemembered comment named the old painter --> FIXED
- [NIT] className rewritten every poll --> FIXED (written only when it changed)

#### Synthetic
- [BLOCKER] S1 (before iteration 2, found by the author): the first same-nodes arm silently skipped under its perturbation (detached node read currentTime null) --> FIXED (node identity + an arm-ran assertion)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html:50950 - the project member panel (#pj-msgs, via setLive) still flashed on a minute tick --> FIXED (0c9dd8cf3: setLive compares by shape; pjVerdict's time is live)
- [WARNING] web/index.html:29321 - remembered-marker change untested --> FIXED (0c9dd8cf3: source pin, stated as such)
- [NIT] a comment line not re-wrapped
- [S2] seven web tests slicing these functions lacked the new helpers; one asserted the old literal markup --> FIXED (0c9dd8cf3)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:29790 - pill applies the stale rule, the grid card does not; plan overclaimed "one sample" --> FIXED (f3ece8f9d: tradeoff stated in code and plan)
- [WARNING] render-agent-pill-3958.js:108 - the stale downgrade had no test; deleting it stayed green --> FIXED (f3ece8f9d: behavioural test on the real functions; deletion reds it)
- [WARNING] web/index.html:36614 - device-ask rows rebuild every poll, same class --> DEFERRED: not a surface in scope; carded #3978
- [NIT] #3966 helpers split pjWhenPart from its docblock --> FIXED (moved below it)
- [NIT] comment quoted paintRoom's old gate --> FIXED
- [NIT] comment quoted setLive's old compare --> FIXED
- [NIT] pjRoomRow computes pjWhen twice
- [NIT] CURRENT also set by refreshAvatar
- [NIT] setLive refreshes times for markup that has none --> FIXED (skipped when no live time)
- [S3] surface gate: render-agentdm-3414.js maps msg-t --> FIXED (re-run green; trailer on f3ece8f9d)
- [S4] fixture-discipline: the new pill test built cards by hand --> FIXED (09add27ab: real fleet cards)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] pjRoomRow double pjWhen computation (dup of iteration 3)
- [NIT] paintRoom refreshes unconditionally where setLive guards
- [NIT] paintRoom's two ifs could be if/else
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html:29795 | BRANCH | fake element lacked dataset | FIXED | 874ac31a4 |
| 2 | 1 | WARNING | web/index.html:19594 | BRANCH | pill ignored stale-working rule | FIXED | 874ac31a4 |
| 3 | 1 | WARNING | web/index.html:29310 | BRANCH | remembered marker read CURRENT | FIXED | 874ac31a4 |
| 4 | 1 | WARNING | render-agent-pill-3958.js | BRANCH | only idle/working covered | FIXED | 874ac31a4 |
| S1 | - | BLOCKER | render-agent-pill-3958.js | BRANCH | same-nodes arm silently skipped | FIXED | 9e66236f7 |
| 5 | 2 | BLOCKER | web/index.html:50950 | BRANCH | #pj-msgs still flashed | FIXED | 0c9dd8cf3 |
| 6 | 2 | WARNING | web/index.html:29321 | BRANCH | marker change untested | FIXED | 0c9dd8cf3 |
| S2 | - | BLOCKER | web.*.test.js | BRANCH | sliced harnesses lacked helpers | FIXED | 0c9dd8cf3 |
| 7 | 3 | WARNING | web/index.html:29790 | BRANCH | pill/card split overclaimed | FIXED | f3ece8f9d |
| 8 | 3 | WARNING | render-agent-pill-3958.js | BRANCH | stale downgrade untested | FIXED | f3ece8f9d |
| 9 | 3 | WARNING | web/index.html:36614 | BRANCH | ask rows rebuild per poll | DEFERRED | #3978 |
| S3 | - | BLOCKER | surface gate | BRANCH | render-agentdm-3414 mapped msg-t | FIXED | f3ece8f9d |
| S4 | - | BLOCKER | fixture-discipline | BRANCH | hand-built cards | FIXED | 09add27ab |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- a long comment line not re-wrapped (2)
- pjRoomRow computes pjWhen twice per special row (3, 4)
- CURRENT is also refreshed by refreshAvatar, not only on open (3)
- paintRoom refreshes times without setLive's guard, and uses two ifs for an if/else (4)

### Strengths (across all iterations)
- The pill key is the composed markup held in a data attribute, sidestepping innerHTML reserialization (1, 4)
- threadShape blanks only the words inside a live-time span every value of which is escaped, so markup with no live time is its own shape and every other setLive caller is unchanged (3, 4)
- Both browser checks assert their arms ran (precondition counts) and compare node identity (2, 3, 4)
- workingSampleIsStale is a byte-preserving extraction shared by the DM line and the pill (2)
