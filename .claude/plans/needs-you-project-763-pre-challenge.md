---
pre_challenge: true
method: challenge-loop
branch: needs-you-project-763
diff_hash: 653e98167ad34c586926714fe875cb230e7ff5beaf2ed39fcbea59c08b6c40a3
subdir_audit: passed
timestamp: 2026-08-25T04:24:40Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (round 2's warnings were all taken, each with a load-bearing test; the walk was re-read against the final code path)
**Total findings:** 19 (0 BLOCKERs, 9 WARNINGs, 2 CONVENTIONs, 8 NITs)
**Fixed:** 17 | **Deferred:** 2

Validation: `yarn test` 2006 passed, 0 failed at f7dc4d7 (23:22, after 0.5.24 served); selfreport 14, status 112, projects 123, the report route 13, all 0 failures; the CLI control with a curl shim; the sandbox walk (a real board, the real CLI, one agent on two projects, the grid photographed at the stated and the unattributed steps: docs/walks/).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] engine/selfreport.js - the carry-forward cleared on stopped only; a crash then a new session leaked the old project --> FIXED (a8518f7: started clears too; cost stated in the plan)
- [WARNING] engine/selfreport.js - the carry-forward is bounded by the 64 KB tail --> FIXED (a8518f7: stated in the plan; a test pins the fail-safe direction)
- [WARNING] engine/status.js - a screen question beside a report that named a project lit nothing --> FIXED (a8518f7: inherited, marked inferred)
- [WARNING] web/index.html - a project whose member needs you elsewhere falls to "Nothing running" --> HANDED to the screen half (Mona Lisa, told) with the two counts that resolve it
- [WARNING] engine/projects.js - needsYouElsewhere lumped "another project" with "none" --> FIXED (a8518f7: needsYouUnattributed)
- [NIT] route accepts non-strings; notify carries no project; flag order --> FIXED (string guard) / DEFERRED (notify) / noted for the wording
- Also (Splinter 23:05, before the round): the carry-forward admits itself --> FIXED (79b0662: projectInferred, stateProjectInferred, needsYouInferred)

#### Iteration 2
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 2 NITs
**Duplicates of prior findings (confirmed resolved):** 5
- [WARNING] engine/selfreport.js - started --project X discarded --> FIXED (f7dc4d7; test)
- [WARNING] engine/status.js - rule 3 inherited with no freshness gate --> FIXED (f7dc4d7: the working decay; tests for stale and fresh)
- [WARNING] engine/projects.js - an id no project owns counted as "elsewhere" everywhere --> FIXED (f7dc4d7: unattributed; test)
- [WARNING] web/index.html - the same card contradicts itself (pill vs member row) --> HANDED to Mona Lisa (told)
- [CONVENTION] the inferred flag's comments said "carried forward" where the meaning is "no report attributed this question" --> FIXED (f7dc4d7)
- [CONVENTION] the CLI's comments named three flags --> FIXED (f7dc4d7)
- [NIT] "agent still shows needs_you" satisfied by the fixture's screen --> FIXED (f7dc4d7: a working screen, so only the report can supply it)
- [NIT] no rule-3 cases for started and stale working --> FIXED (f7dc4d7)
**Converged** - every actionable finding taken with a test; the phone notification's project stays deferred by the plan.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | selfreport.js | Crash leaks the old project | FIXED | a8518f7 |
| 2 | 1 | WARNING | selfreport.js | Tail bound unstated | FIXED | a8518f7 |
| 3 | 1 | WARNING | status.js | Screen question lit nothing | FIXED | a8518f7 |
| 4 | 1 | WARNING | web/index.html | Pill falls to Nothing running | HANDED | Mona Lisa |
| 5 | 1 | WARNING | projects.js | Elsewhere lumped with none | FIXED | a8518f7 |
| 6 | 2 | WARNING | selfreport.js | started --project discarded | FIXED | f7dc4d7 |
| 7 | 2 | WARNING | status.js | No freshness gate | FIXED | f7dc4d7 |
| 8 | 2 | WARNING | projects.js | Unknown id counted elsewhere | FIXED | f7dc4d7 |
| 9 | 2 | WARNING | web/index.html | Card contradicts itself | HANDED | Mona Lisa |

### NITs (non-blocking, across all iterations)
- Listed under each iteration; six fixed, two deferred (the phone notification's project; the flag must precede the sentence, like its siblings).

### Strengths (across all iterations)
- The projects summary test goes through the real seam: a recorded report, a roster the status engine builds (iterations 1 and 2)
- The route test walks two projects sharing one member end to end (iteration 1)
- Consumers swept: the phone and the Agents-page count unchanged; the projects header now counts attributed questions, which is the ruling (iteration 2)
