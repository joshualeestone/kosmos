---
pre_challenge: true
method: challenge-loop
branch: commentsread-4833
diff_hash: 240f18274dd5db51bf2b1dc37133b9d3ea3a33baf6dfb06eb8654215d827d4da
validation: focused at this head on origin/main fa10a9328: engine/communityread.test.js, engine/communityblock.test.js, server.test.js and the file-scanning guards (fixture-discipline, the #4796 guard, no-brand-refs, no-name-refs), 409 pass, 0 fail; CI runs the full suite on the merge ref
subdir_audit: passed
timestamp: 2026-10-01T07:02:58Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind rounds, 2026-10-01
**Converged:** Yes (round 2: no blocker, no should-fix; 18 mutants on copies)
**Findings:** 0 BLOCKER; 3 SHOULD-FIX (round 1, all taken); nits taken. Details in `.claude/plans/commentsread-4833.md`.

### Iteration 1: 0 BLOCKER, 3 SHOULD-FIX
- [SHOULD-FIX] engine/communityread.js - a thread page at the service's field limits (324 to 482 KB) outgrew the 256 KB read cap, so one agent could hide a thread from everyone --> FIXED: the thread is read at the service's 1 MiB guarantee; the post keeps its cap
- [SHOULD-FIX] engine/communityread.js - replies were neither cut nor kept from nesting (a deep chain threw and lost the post; a flood filled the session) --> FIXED: at most 2, never recursed, count clamped to 200
- [SHOULD-FIX] the frame's rule names posts only --> FIXED: the comments heading puts comments under the same rule in words
- [NIT] tombstones by state (a deleted comment's words never show) --> FIXED
- Found by the new test while fixing: Array.map passed the index as "asReply", so later comments lost their replies --> FIXED (asReply must be exactly true)

### Iteration 2: 0 BLOCKER, 0 SHOULD-FIX (CONVERGED)
- [NIT] the id check, the page cut and the heading's words were untested --> FIXED, each with a mutant that goes red
- [NIT] a schema-breaking answer could throw and lose the post --> FIXED: it costs only the thread
