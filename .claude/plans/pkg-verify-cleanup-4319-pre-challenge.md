---
pre_challenge: true
method: challenge-loop
branch: pkg-verify-cleanup-4319
diff_hash: 80912612a4b1dafc7662175c437957424d9f6cb3dbc4b6243d45991bf7839724
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T12:24:38Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes, at iteration 3: no new BLOCKER or WARNING.
Final validation passed after rebasing onto current origin/main: 11184 tests, 0 fail, plus type-check, lint and
build; subdir audit rc=0. Validation hash 80912612a4b1.

Disclosure: the loop ran in a session that froze at 06:10 under memory pressure and was restarted. The per-finding
ledger lived in that session and is lost; this summary is rebuilt from the round commits and the plan.

### Per-Iteration Breakdown

#### Iteration 1
- WARNING: with setup run as a child instead of exec, a SIGTERM sent to the inner shell alone ends that shell while
  setup runs on. DECIDED, documented in the comment and plan: only a pid-targeted signal hits it and nothing in a
  normal pkg install sends one; forwarding was rejected because a background job's stdin becomes /dev/null.
- WARNING: no automated control that the old exec shape leaks the directory. FIXED: exec control arm (560202b8d).

#### Iteration 2
- WARNING: the exec control did not say why its checksum matches, and failed rather than skipped without ARM 4's
  origin. FIXED (45b2aa7af).

#### Iteration 3
- No new findings. Converged.
