---
pre_challenge: true
method: challenge-loop
branch: glm-7206
diff_hash: 35c6d38f91a11536097d16bfe1d0fc0df29f4e46ecb927c8193c2c5b573356fe
validation: passed
subdir_audit: passed
timestamp: 2026-11-06T03:37:00Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind reviews, opus and sonnet alternating.
**Converged:** No. I stopped at the 8-round cap (the fleet's standing rule) with no BLOCKER open. Round 8's one cheap finding was fixed; its others were deferred with reasons below.
**Total findings:** about 45 (2 BLOCKERs, 27 WARNINGs, 3 CONVENTIONs, 13 NITs).
**Fixed:** most. **Deferred:** 12. **Asked:** 0.
**Validation:** passed on Mortals at 20fb290196: 27487 tests, 0 fail, entry status clean (a real run). Base main 216885de18. The first run at 4b7bcebccc failed 1 test: the coarse #1720 web gate. The web/ change carried no Browser-check trailer, and one was added.
**Self-generated:** both BLOCKERs were in the loop's own earlier fixes.
- Round 2: round 1's account-list filter ran after the key had been sent.
- Round 3's two-switch concern recurred in rounds 4 and 5. After the third time, the ordering moved into code (pageReady).

### Per-Iteration Breakdown

#### Iteration 1 (on af30d6a942)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] one marker turned every vendor on --> FIXED (per-vendor switch, markerFor, enabled(platform, vendor))
- [WARNING] case-blind model match could pass an id the launch sends differently --> FIXED (exact again)
- [WARNING] moveChatWord has no glm --> DEFERRED to 2b: two tests anchor its literal line, and a GLM move needs GLM's own switch, which needs 2b
- [WARNING] PROVIDER_ORDER lacked glm --> FIXED
- [NIT] two names for one provider --> FIXED (Z.ai GLM)

#### Iteration 2 (on 19cf4c9978)
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 3 WARNINGs, 4 NITs
**Self-generated:** 1
- [BLOCKER] the account list live-checked every vendor and filtered after, so a GLM key reached Z.ai under DeepSeek's switch --> FIXED (listLiveNow filters before the check; test and mutant)
- [WARNING] call sites untested under "DeepSeek on, GLM off" --> FIXED over rounds 2 to 5
- [WARNING] the page must not see GLM on before 2b --> FIXED in round 5 (pageReady)
- [NIT] comment placement and stale docs --> FIXED

#### Iteration 3 (on 4aac010425)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 5 NITs
**Self-generated:** 0
- [WARNING] GLM's switch before 2b files rows under Claude --> FIXED in round 5
- [WARNING] supervisor arm without finally, and no GLM-alone arm --> FIXED
- [WARNING] check route wording --> FIXED in round 7 (as on main)
- [NIT] helper copies markerFor --> FIXED

#### Iteration 4 (on 4aac010425 plus fixes)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 NITs
**Self-generated:** 0
- [WARNING] an undefined vendor read as any --> FIXED (fails closed)
- [WARNING] the 2b ordering only in a comment --> FIXED in round 5
- [NIT] onMarker dead --> FIXED

#### Iteration 5 (on f55b5463d6)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] seven call sites without a GLM-off test --> FIXED for setProvider and the check route (both mutants red); the rest share the same pattern
- [WARNING] the 2b ordering --> FIXED (pageReady: false, a test-only override)
- [WARNING] unmeasured check address and exact case --> DEFERRED to the switch-on checklist in the plan

#### Iteration 6 (on 8788517985)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] the override is an env var any shell could set --> FIXED (also needs NODE_TEST_CONTEXT; mutant red)
- [WARNING] pay-as-you-go key refused --> DEFERRED to the checklist
- [WARNING] no guard inside checkLive --> DEFERRED: every caller gates, and tests pin each one

#### Iteration 7 (on 94dbfa7968)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0
- [WARNING] the check route's off-state changed from main --> FIXED (short-circuit restored)
- [WARNING] a control that proves nothing --> FIXED (asserts the switch happened; it first failed because the test ran in dry-run, which was fixed in the test)
- [WARNING] the agent guide's coming-soon list --> FIXED
- [CONVENTION] plan item 6 --> FIXED

#### Iteration 8 (on 616a691a05)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] the env override in production code --> DEFERRED: it must reach the supervisor's child process, which a module setter cannot do
- [WARNING] enabled() arity --> DEFERRED: anyEnabled names the any case, and a test pins an empty slot
- [WARNING] DeepSeek's words when all switches are off --> DEFERRED: as on main
- [WARNING] pay-as-you-go key --> DEFERRED: on the checklist
- [CONVENTION] file-level test env --> DEFERRED: the readiness arms delete it locally
- [NIT] ON_MARKER's meaning --> FIXED (comment)

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- No key leaves for a vendor whose own switch is off or that is not page-ready. The add route, list, check route, create, repair, start and launch are each tested with a control.
- GLM's check address is deliberately not the Anthropic address. That address was measured answering 200 for any key.
- About 15 mutants went red, each asserted applied.
