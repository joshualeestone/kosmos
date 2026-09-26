---
pre_challenge: true
method: challenge-loop
branch: subtasks-3861
diff_hash: c029f8e091d7643b6c0639b026193b61d4f1ca8ecd24127148ff740596ccceab
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T02:13:44Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary (part 1: data, engine, API, both CLIs, doctrine line)

**Iterations:** 3
**Converged:** Yes (iteration 3 had nothing at WARNING or above)

Iterations 1 and 2 ran under April (commits 8a3800c, 902c4c3, "address challenge-loop iteration N findings").
Re-routed to Mona Lisa 21:05 (Splinter); she continued from 902c4c3.

#### Iteration 3 (opus)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 5 NITs
**Self-generated:** 0
Verified: self-parent and cycles at any depth refused (with a seen set against hand-edited loops), checked inside the
same projects.mutate as the write; a parent is a bare number in the same project, so no cross-project spelling;
input validation (0, negatives, fractions, NaN, huge, booleans, objects, arrays, '3.0' refused; '' and null clear);
routes answer 400/404 like /due; a missing parent reads as top level everywhere; no task consumer in web/index.html
reads parent yet; stored tasks without parent read as null; Mac and Windows CLI grammar and refusals match; the
tests assert unchanged state after refusals with controls.
NIT taken (7854cf7): the Windows CLI refuses a sentence of --parent=<n> as the Mac one does; its test fails without it.
NITs not taken: a hand-edited dangling parent becomes real when that number is later created (needs a hand edit);
clearing a dangling parent logs "parent-cleared"; the doctrine line repeats once per project (Josh's call); the
parent's own feed does not log a child being put under it (part 2's task page can show it).

## Validation
6j on HEAD: full suite clean (hash c029f8e091d7), subdir audit clean. engine/tasks.subtasks-3861.test.js and
server.subtasks-3861.test.js pass (the latter 11).
