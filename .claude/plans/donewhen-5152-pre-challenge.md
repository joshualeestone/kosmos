---
pre_challenge: true
method: challenge-loop
branch: donewhen-5152
diff_hash: 21f8f0baa679df427ba1d2c2d9dc07a020bfab6c37f815420c5e4b79cff71d13
validation: passed (validation-log helper at 6ca31181b: tools/run-tests.sh full suite, FAILS: 0, "validation PASSED for stack=typescript hash=21f8f0baa679", 5316 s; claude -p measurements per wording in the plan)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-03T19:37:40Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (fresh blind reviewers, read only)
**Converged:** Yes. Round 4 raised no new issues.
**Fixed:** every finding from rounds 1 to 3 | **Deferred:** a CLI that prints the new task's number (named in the plan's Known gaps, routed to Splinter)

### Per-Iteration Breakdown

#### Iteration 1 (e749fa4e3)
- Added the existing-task case (do not add a second task; message the checks onto it) and where the task number comes from --> FIXED, re-measured (v2 wording)
#### Iteration 2 (988e3ed8b)
- The 200-character limit on the task line, and "run kosmos task list right after and note your number" --> FIXED, re-measured (v3 wording: work 4/4, given a task 2/2, small talk 1/1)
#### Iteration 3 (dd3cf26fa): 5 WARNING, 3 NIT
- [WARNING] work belonging to none of the agent's projects had no rule --> FIXED (do not guess another: checks in the reply)
- [WARNING] the templates double-quote checks the block's own trap says the shell expands --> FIXED (single quotes for a check with a backtick or $)
- [WARNING] the version log said the final wording "is re-measured on the PR" --> FIXED (v3 and v4 numbers logged)
- [WARNING] kosmos task add does not print the number --> DEFERRED (Known gaps; the section has the agent list after adding)
- [WARNING] several agents asked in one room would each add a task --> FIXED (one task between you; list first, say its number)
- [NIT] a missingFrom assertion like #4873's --> FIXED
- [NIT] doctrine-past rows and the fingerprint re-pinned; main's two v21 rows kept
- [NIT] the projects.js built-note wording "what is left" left as is: it is the CLI's own help, not in conflict
#### Iteration 4 (6ca31181b): no new issues
- [STRENGTH] pins match the text: block() 23939 chars, sha a660bad1..., section 936a8f3a... present and sorted
- [STRENGTH] the quoted CLI shapes match install/kosmos and tools/windows/kosmos-cli.js; the limits match SENTENCE_MAX and BUILT_NOTE_MAX
- [STRENGTH] no em dash in any spelling; "the trap above" points at the right paragraph
- [STRENGTH] the content test can fail: a mutant ("add a task each") reds it and the fingerprint
