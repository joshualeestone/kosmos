---
pre_challenge: true
method: challenge-loop
branch: reviewer-4787
diff_hash: e16a14d61eafa22f6b8f84b3261ccb67fcc43495059f4b78d99797846508d560
validation: focused after every round (engine/missedtell.test.js, engine/tasks.repeat-4787.test.js, server.task-repeat-4787.test.js, cli.task-reviewer-4787.test.js, web.task-repeat-4787.test.js), and at convergence, rebased onto main after #5416 merged, every root-level and engine test file: 15849 pass, 0 fail, rc 0 (CI then caught fixture-discipline, which the narrower local globs had skipped; fixed). Each fix's test was proven to fail by undoing the fix. Browser: a new arm in render-onhold-4771 for "If missed, tell" (added after convergence; CI is its first run; its first CI run caught the new select missing the field fill in dark, fixed). Surface trailers for render-unread-edge-3743 and render-agentdm-3414 (local "msg").
subdir_audit: not run
timestamp: 2026-10-06T22:11:31Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14
**Converged:** Yes (iteration 14: NO NEW ISSUES)

#### Iteration 1: 5 warnings, 5 nits
- [WARNING] a quota-held or busy delivery spent a try, so a slot was given up on --> FIXED
- [WARNING] a placed line was retyped every minute if its mark could not be saved --> FIXED (the book keeps 'told')
- [WARNING] a reviewer taken off the project was still typed into --> FIXED
- [WARNING] a held task or paused project went to Needs Your Decision --> FIXED
- [WARNING] a rule with a refused reviewer was half-applied --> FIXED (reviewerProblem first)
- [NITS] the person's Nobody unprotected; history lost the slot; focus dropped; stale select after moving; CLI line --> FIXED

#### Iteration 2: 1 warning, 4 nits
- [WARNING] an agent could clear the rule to escape the person's reviewer, then name its own --> FIXED
- [NITS] --at/--on dropped without a frequency; 404 for a missing task; a comment; archived project --> 3 FIXED, 1 LEFT (in the plan)

#### Iteration 3: 2 warnings, 1 nit
- [WARNING] closing kept the reviewer, which came back on reopen still marked the person's --> FIXED (dropReviewer)
- [WARNING] an owner who reviews was told twice --> FIXED, then REVERSED in round 5
- [NIT] the route kept a time with no frequency --> FIXED

#### Iteration 4: 1 warning, 2 nits
- [WARNING] an agent whose part was done counted as owner --> FIXED (open parts)
- [NITS] 'nobody'; 403 for stopping the person's task --> FIXED

#### Iteration 5: 3 warnings
- [WARNING] history printed raw kinds --> FIXED (tkActPhrase)
- [WARNING] the missed note counted as activity --> FIXED
- [WARNING] an owner-reviewer could be told nothing (the nudge needs the Prompter on) --> FIXED (told, in its own words)

#### Iteration 6: 2 warnings, 2 nits
- [WARNING] a finished task kept the reviewer row --> FIXED
- [WARNING] closing let a process wipe the person's reviewer --> FIXED (close guards)
- [NITS] capped count; roster read while nothing can be typed --> FIXED

#### Iteration 7: 2 nits --> FIXED

#### Iteration 8: 1 warning, 1 nit
- [WARNING] a reviewer switched off in the project was typed into --> FIXED
- [NIT] a miss before the person chose Me was put on them --> FIXED

#### Iteration 9: 1 BLOCKER, 1 warning
- [BLOCKER] the line was typed whatever the reviewer's state, so into a permission prompt --> FIXED (nudgeableCard: idle)
- [WARNING] control characters made the line refused every try --> FIXED (plainWords)

#### Iteration 10: 1 BLOCKER, 1 warning
- [BLOCKER] several lines to one reviewer in one pass, each judged idle from one roster read --> FIXED (one per pass)
- [WARNING] a line the instant the reviewer went idle --> FIXED (settled idle)

#### Iteration 11: 1 warning
- [WARNING] two samples missed a turn between them --> FIXED (the reviewer's own idle report; reset after a line)

#### Iteration 12: 1 warning, 2 nits
- [WARNING] a lasting hold never recorded --> FIXED (recorded once; "(left the project)")
- [NITS] none/me case; close wording --> FIXED

#### Iteration 13: 1 warning
- [WARNING] a thrown delivery was retyped --> FIXED (unconfirmed)

#### Iteration 14: NO NEW ISSUES
