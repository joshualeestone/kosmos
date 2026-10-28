---
pre_challenge: true
method: challenge-loop
branch: rmmember-7405
diff_hash: cbe541775ebf0443ed76cf360fc38f466ad1f2712003e742d7f57721d3881564
validation: failed-unrelated (every test passed; see Validation below)
subdir_audit: passed
timestamp: 2026-10-28T04:51:09Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the standing 8-round cap after iteration 8, with no BLOCKER open. Iteration 8's two small fixes (a CLAUDE.md routing row and an unused variable) were NOT reviewed by a further round.

Validation, stated exactly, not as "passed":
- **Run 1 (22:05 CDT):** failed on one test outside this branch, `engine/messages.typingbroke-4926.test.js` ('#4926 review 1'). It fails about 1 run in 2 when run alone, on main too. This branch touches no messages code. Card #7432.
- **Run 2 (23:47 CDT, on this diff, hash cbe5417...):** every node test passed, and all 4 shell shards passed (76/76 on the last). The run failed only on the #4273 leak check: one `aw-projects-*` temp folder, from `server.projects.test.js`, which this branch does not touch. Run alone, that file passes 182/182 and leaves nothing. The folder holds only files the board's timers write, so a timer evidently writes after the file's cleanup. Card #7442.
- The subdir CLAUDE.md audit: rc 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] The overview was read at the top level, but the route answers { project }. A hand-built fixture hid it --> FIXED: the fixture is now built from projects.describe plus overviewOf.
- [WARNING] 200 with project:null --> FIXED: exit 3. [WARNING] DELETE had no timeout --> FIXED: 120 s. [WARNING] . and .. names --> FIXED: guarded.

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] A non-JSON DELETE answer --> FIXED: exit 3 on both platforms. [CONVENTION] The confirm wording now matches the screen's --> FIXED. [WARNING] The Mac y/N prompt was untested --> FIXED: tested through script(1).

#### Iteration 3
**Reviewer model:** opus
- [WARNING] A sessionName equal to another member's display name removed the wrong member, silently --> FIXED: every match by either name, ignoring case; more than one match sends nothing.
- [NIT] Real valve text, help lines, and "not from the screen" in the plan --> FIXED.

#### Iteration 4
**Reviewer model:** sonnet
- [BLOCKER] cli.project-show-4581.test.js pinned the Mac usage line, and I had missed it --> FIXED.
- [WARNING] Names are now cleaned through projectview.one, and the raw sessionName is URL-encoded for the path --> FIXED.

#### Iteration 5
**Reviewer model:** opus
- [WARNING] Circular "use these names" advice --> FIXED. [WARNING] A false "not on the project" for a stopped member --> FIXED.

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] My extra replace stripped ZWJ/ZWNJ --> FIXED: used as the fallback only. [NIT] The test links the repo engine into the sandbox --> FIXED.

#### Iteration 7
**Reviewer model:** opus
- [WARNING] A partial list read as all the candidates, which could lead --yes to remove the wrong member --> FIXED: none are offered then.

#### Iteration 8
**Reviewer model:** sonnet
- No BLOCKER. [CONVENTION] A CLAUDE.md routing row --> FIXED. [NIT] An unused variable --> FIXED. Neither fix was re-reviewed.

### Gaps decided, not missed
- No server change: the board records a removal made from the CLI as "not from the screen", because it cannot tell a person at a terminal from anything else.
- Mac refusals go to stdout and Windows refusals to stderr. Only the Mac names the board's address, as `agent remove` does.
