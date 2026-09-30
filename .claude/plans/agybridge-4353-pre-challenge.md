---
pre_challenge: true
method: challenge-loop
branch: agybridge-4353
diff_hash: c2933d15697b189cc5c7d6b692f3dee2a007fdf6698d68572cd7058a9c34a354
validation: passed (Mortals) on head 4c1aa0276, full suite, hash 623668c19eb3, 2026-09-30T18:06:42Z; changes since are plans only
subdir_audit: passed
timestamp: 2026-09-30T18:08:18Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (sonnet, opus, fable)
**Converged:** Yes (iteration 3 found no BLOCKER, WARNING or CONVENTION)

### Iteration 1 (sonnet)
- [WARNING] (fixed) a running agent whose launch folder was deleted or moved would get that folder made again, empty; the wiring now returns no folder for one that is not there, and the refresh says so. Test with a control.
- [WARNING] (fixed) the first wiring test scanned only one call shape and read comments; it now BUILDS productionDeps() for real, strips comments, pins the create functions, and covers agyhooks and allowance.
- [NIT] (fixed) "thirteen tests" counted the new one.

### Iteration 2 (opus)
- [WARNING] (fixed) the folder guard was tested only through a fake; the wiring test now calls productionDeps().workdir, .hasHook and .hadToolHooks for real.
- [CONVENTION] (fixed) the header said "Never throws" of the wiring; the plan's top described the first design.
- [NIT] (fixed) the gone-folder test uses the real hook writer; a self-comparing assertion removed; the scan's limits are stated; release numbers out of comments.
- [NIT] (not taken) a trailing // comment would be read by the scan (the pinned list turns that red); a regular file at the launch path passes the existence check (the writer then refuses it).

### Iteration 3 (fable)
- No BLOCKER, WARNING or CONVENTION. The reviewer traced the wiring test's real calls through create.js and confirmed they only read inside the test's sandbox, and that the gone-folder test fails on disk without the guard.
- [NIT] (not taken) job does not ask launchd, so it too could run for real in the test; a trailing // comment; a regular file at the launch path.

### Validation
- Mortals full suite PASSED on 4c1aa0276 (13:06 CDT).
- Controls on scratch copies: the export removed reds the wiring test with the error production logs; the folder guard removed reds the gone-folder test.
