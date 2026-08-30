---
pre_challenge: true
method: challenge-loop
branch: uninstall-litter-1547
diff_hash: c0af7abe39ac5e3c13ff480eb09afc8265850caeb45f3603dc76ad41391913cb
validation: passed
subdir_audit: passed
timestamp: 2026-08-30T14:56:52Z
iterations: 5
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** No (stopped at user request after iteration 5)
**Stopped by:** Splinter, 2026-08-30: the bar is zero BLOCKERs, and an honest `converged: false` ships. Iteration 5 returned none.
**Total findings:** 24 (6 BLOCKERs, 11 WARNINGs, 1 CONVENTION, 6 NITs)
**Fixed:** 24 | **Deferred:** 0 | **Asked:** 0

### 🛑 Six blockers, every one mine, and four of them were the uninstall saying something untrue

This card deletes directories from a person's data folder, so the review was aimed there,
and what it kept finding was not deletion bugs. It was **sentences**. Recorded here because
the pattern is more useful than any single fix.

| # | The untrue sentence | Found in |
|---|---|---|
| 1 | The sweep said it removed the ping log. It removed nothing: it looked one folder too high. | iter 1 |
| 2 | The plan said `wouldping` was "the only litter I could name confidently". Five more existed. | iter 2 |
| 3 | The closing line said agents' files were left alone IN THAT FOLDER, while the sweep removed per-agent records from it. | iter 4 |
| 4 | The closing line claimed the removal happened even when the sweep had just FAILED and said so four lines above. | iter 4 |
| 5 | The "left alone and named" table listed four files the same function deletes twenty lines earlier. | iter 4 |
| 6 | The table called `remote/` handled, when it is removed only under four nested conditions, and it holds this Mac's Plus key. | iter 5 |

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 2 BLOCKERs
- [BLOCKER] install/setup.sh - the sweep re-derived its path from `AGENT_WORKFORCE_DATA`, which is the PARENT of the AgentWorkforce folder (`engine/store.js:85` joins APP onto it), so it looked in the wrong place and removed nothing. It appeared to work only on a fully default install, where the fallback string happens to contain the segment --> FIXED (uses the in-scope `_support`, computed once 57 lines above, which is this file's own stated rule)
- [BLOCKER] install.uninstall-litter-1547.test.js - the fixture seeded the path the BUGGY code looked at, so all three arms passed against a sweep that never found the real file. **And it pinned the buggy source literal, so the CORRECT FIX reddened the test**: the guard was actively cementing the defect it was written to prevent --> FIXED (fixture seeds the real layout; the pin names the single derivation, not a spelling)

#### Iteration 2
**New findings:** 1 BLOCKER, 2 WARNINGs, 3 NITs
- [BLOCKER] the fix was half a fix: 2 of at least 6 directories of the same class, and the biggest was missing (`downloads/`, which `connect.js` records as ~281MB when stranded). So it removed a small log and left the largest object --> FIXED (all six, derived by searching for the writers)
- [WARNING] no count discipline, on a line where the sibling block 40 lines up already proves it is needed --> FIXED
- [CONVENTION] user-facing copy leaked module names (`removing Kosmos's own wouldping records`) --> FIXED
- NITs on a narrow source guard, an announce-before-attempt ordering, and a stale test name --> FIXED

#### Iteration 3
**New findings:** 2 BLOCKERs, 3 WARNINGs, 2 NITs
- [BLOCKER] **my own sweep falsified the uninstall's closing sentence.** It said agents' files were left alone in that folder; `liveness/` and `selfreports/` are keyed per agent inside it (`liveness/angel.json`, verified against the real folder on this machine). True until the sweep existed, and nothing failed --> FIXED (sentence names the split; a test arm reds on the exact old wording)
- [BLOCKER] the "left alone and named" table listed four files the same function deletes at line 1397. Two contradictory rulings in one function, the newer wrong --> FIXED
- [WARNING] the derivation command bolded as "the fix" was blind: `grep -c 'store\.ROOT' engine/styles.js` returns 0 for a file that writes there, because `styles.js` and `trust.js` use an inline `require('./store').ROOT` and `create.js` goes through `supportDir()` --> FIXED (search for the WRITES; the plan now says so)
- [WARNING] ten more children in neither list --> FIXED (all named, with reasons)
- [WARNING] announce-before-attempt with the failure swallowed --> FIXED (remove first, report what was observed)

#### Iteration 4
**New findings:** 2 BLOCKERs, 4 WARNINGs, 2 NITs
- [BLOCKER] the closing line asserted the removal unconditionally, so one transcript could tell a person BOTH that a file could not be removed AND that it was removed. Driven with `chmod 500`; disk agreed with the note --> FIXED (conditional on nothing left behind, not on something taken: `_swept` is yes when ANY of six went, and **that second bug was caught by the new test rather than by reading it**)
- [BLOCKER] **the failure path had no test arm at all.** Both message sites were added in one commit; one got three assertions and the other none, so the only new failure-reporting code was the half nobody drove. An unconditional failure left the suite 3/3 green --> FIXED
- [WARNING] the survivor note named neither what survived nor where, the only note in this function naming no path, against a header contract requiring exactly that --> FIXED
- [WARNING] the sweep line described the removal as agent records; three of the six are not, and it fires on machines with no agents, which setup.sh:1405 forbids --> FIXED
- [WARNING] `policy.json` cited in the prose as covered and absent from the list; `remote/` in no section --> FIXED
- [NIT] the module-name guard missed two of the six, proven by mutation --> FIXED
- [NIT] a control figure in the plan that did not reproduce (`grep -c` is 1, not 2), inside the section whose subject is unverified claims --> FIXED

#### Iteration 5
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 NITs
- [WARNING] **the "no litter, say nothing" test could not fail on the thing it exists for.** It asserted the absence of `removed the records Kosmos kept`, which THIS BRANCH renamed two commits earlier, so it asserted the absence of a string nothing could emit. Mutating the announcement to unconditional left all four tests green --> FIXED (re-aimed at the live string; the mutation now reds)
- [WARNING] the table called `remote/` handled; it is removed only under four nested conditions, and it holds this Mac's Plus key --> FIXED (stated as a condition)
- [WARNING] the announce line still made the unqualified past-tense claim the closing line had just been fixed for --> FIXED (by wording, not by gating: gating gives the opposite defect)
- [NIT] the closing message no longer named a location --> FIXED (`$_support`, which is right on a non-default data root where the old hardcoded path was wrong)
- [NIT] `bin/` in none of the three sections --> FIXED

### Outstanding questions (ASKED, still unresolved)

None.

### 🛑 The weakest premise, named by me

**The sweep names six directories and a SEVENTH added later is not covered.** The count is
pinned in both the comment and the test so a member silently dropped is visible, but
nothing fails when a new one is never added. A guard watching `store.ROOT` writers for
unswept names would close it and is wider than this card.

**And I deliberately did not widen the deletion set further.** Twelve more children are
named with per-directory reasons rather than swept, because every round of widening this
list introduced a defect, the six swept are directories of pure machine output, and the
twelve are single files several of which hold settings a person set. Naming cannot break
anything; deleting cannot be undone.

⚠️ **One thing the table is only accurate about on a default install:** several modules use
`BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT`, which short-circuits past the
`AgentWorkforce` segment. Those are all in the LEFT-ALONE section, so they are only ever
*not* deleted, which is the safe direction. Pre-existing and not introduced here.

### Strengths recorded by the blind reviewers

- The user-data control returns the dangerous answer: a mutation that also deletes `secrets/key.env` reds on the person's credentials, not on a source pin. Seeding `secrets/` specifically, the case a "we wrote it, so it is ours" rule gets wrong, is the right choice of victim.
- Symlink behaviour verified safe in both directions, with no trailing slash on the `rm` target, so a symlinked litter directory is unlinked rather than descended.
- The six swept are each defensible as ours, checked independently rather than on the table's word: `downloads/` is a staging dir the code already empties on success, `usage/` is recomputable, `sendertokens/` are capability tokens for a deleted app. `engine/forget.js` independently classifies exactly `chats` and `commitments` as the person's, and the table agrees with the one module that owns that judgement.
- The node fixture is the only place the "our six go, `secrets/` and `chats/` stay" pair is actually tested: the shell harness seeds its user data one level higher and cannot exercise it.
