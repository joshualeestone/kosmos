---
pre_challenge: true
method: challenge-loop
branch: reread-8989
diff_hash: 57287383bef65dc2ed7414ac3d2ab881907127b74a0a3a1836515e4f9162eb79
validation: passed
subdir_audit: passed
timestamp: 2026-11-24T18:01:08Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the round-8 cap after iteration 8: Splinter's standing usage rule, 2026-10-22 and restated 2026-10-26, "past round 8 only an open BLOCKER continues"; no BLOCKER was open)
**Total findings:** 0 BLOCKERs; the WARNINGs and CONVENTIONs are listed per iteration below
**Asked (awaiting user):** 0

### Validation
- Each round ran the focused set: server.reread-close-8989.test.js, server.reread-e2e-8989.test.js,
  engine/tasks.assignprevious-8989.test.js, and engine/projects.test.js filtered to "8989|5320". Every new rule was
  checked by a mutant that fails its test (named per iteration below).
- Full validation on the final head 5880d6bfc4 (12:00 CST): node 30,363 passed, 0 failed; shell part passed; subdir
  audit passed. validation_rc=0, first attempt.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus

- [WARNING] part close/reopen told nobody FIXED (the route names its caller after the change)
- [WARNING] a hold set by someone else NO CHANGE (rulesChangedIn already owes a hold mark change)
- [WARNING] a retitle by someone else FIXED (byOther)
- [WARNING] givePart never synced the agent a part was moved away from FIXED
- [WARNING] bulk close and built subtasks untested FIXED (tests; a mutant per path fails)
- [NIT] weakest premise wider than "an older CLI" FIXED (plan); header shapes noted
- [CONVENTION] PR body uses "Addresses #8989" FIXED

#### Iteration 2
**Reviewer model:** sonnet

- [WARNING] the previous holder read before the write could race FIXED (assignPart returns previous from inside its write)
- [WARNING] an extra store read on the Assigner's path FIXED (same)
- [WARNING] text route and an agent's own part move untested FIXED (tests)
- [WARNING] no unstubbed route-to-debt test DEFERRED to iteration 3, where it was added
- [NIT] pending block drift carried by a byOther write noted; a refused token reads as someone else noted

#### Iteration 3
**Reviewer model:** opus

- [WARNING] a part closed while other parts stay open owes nothing DOCUMENTED (the section lists tasks; plan limit)
- [WARNING] route tests mirror the implementation FIXED (server.reread-e2e-8989.test.js, nothing stubbed, fails without the fix)
- [WARNING] delivery can be late, ask 2 DECLINED with reason (plan)
- [NIT] actor matched with !== FIXED (store key too; mutant caught)
- [NIT] a project renamed on the screen owes no re-read noted (out of scope)

#### Iteration 4
**Reviewer model:** sonnet

- [WARNING] a previous holder no longer a member DOCUMENTED (the engine owes nothing)
- [WARNING] part route reads its caller via a pane claim DOCUMENTED
- [WARNING] a pane claim matches by key, lenient DOCUMENTED
- [NIT] unused boilerplate, comment placement, one restore for every stub FIXED

#### Iteration 5
**Reviewer model:** opus

- [WARNING] a paused or switched-off project now sent notices (worse than main) FIXED (no notice there; three tests, mutant fails 3)
- [WARNING] the Assigner's failover source got two lines FIXED (failovertell already tells it; test, mutant caught)
- [WARNING] a tokenless agent's own close is typed a notice DOCUMENTED (the close route has no pane claim)
- [NIT] comments describing the part route FIXED

#### Iteration 6
**Reviewer model:** sonnet

- [WARNING] the bulk close read the store per task per assignee FIXED (one read before its syncs)
- [WARNING] a pause judged as of an earlier close in the loop FIXED (same)
- [WARNING] the failover arm silenced any previous holder FIXED (only the failover's own source; test, mutant caught)
- [WARNING] no end-to-end paused case FIXED (real pause, real section, no debt; mutant caught)

#### Iteration 7
**Reviewer model:** opus

- [WARNING] a store-key match read two agents ("Mona Lisa", "monalisa") as one FIXED (key only when one member has it; test, mutant caught)
- [WARNING] five sites decided it three ways FIXED (one owesNotice rule at every site)
- [WARNING] undefined vs null changedBy, missing projectId FIXED (an explicit notice option)
- [NIT] plan out of date FIXED; per-holder reads noted

#### Iteration 8
**Reviewer model:** sonnet

- [WARNING] an unreadable project with a key twin read as the same agent FIXED (owed)
- [NIT] a non-member holder, the bulk any-of, a refused token noted

### Strengths (across all iterations)
- [STRENGTH] The engine change is one condition (byOther and the block changed); everything else is who made the change, decided by one rule.
- [STRENGTH] An end-to-end test with nothing stubbed reproduces the card's bug when the fix is taken out.

### Outstanding questions
None. The call, what was rejected, the weakest premise and the stated limits are on #8989 and in .claude/plans/reread-8989.md.
