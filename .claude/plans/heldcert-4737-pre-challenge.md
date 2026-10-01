---
pre_challenge: true
method: challenge-loop
branch: heldcert-4737
diff_hash: d119aca971436a7fbbfa835ff9261dff98b98f49e4f4687829a0525b9c30fff0
validation: focused, on b4810eed3 (the converged head before the rebase onto f939828c4): node --test engine/enrolment.test.js engine/remote-report.test.js engine/remote.test.js, 158 run, 158 passed, 0 failed, every #4737 arm and both controls among them (Agent1s, queued-heavy, 09:22 to 09:24 CDT); the rebase was clean, and main's own changes since then to engine/remote.test.js (15 lines) and web/index.html are NOT covered by that run, they are covered by this PR's CI (the full node suite), and the PR merges only on its green
subdir_audit: passed
timestamp: 2026-10-01T14:25:23Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind reviews of both halves together (this app branch and kosmos-relay `heldcert-4737`), recorded in
`.claude/plans/heldcert-4737.md` here and in the relay plan.
**Converged:** Yes. Review 1: 0 BLOCKER, 1 WARNING (relay side), 7 NITs, the applicable ones taken. Review 2: CONVERGED,
4 NITs, all taken (one of them added the two `halfRegistered()` arms here). Review 3 (the delta after review 2):
CONVERGED, 2 test-hygiene NITs, recorded and not taken.
**Fixed:** every WARNING and the taken NITs, one commit per review. **Asked:** 0

Mutation evidence: a scratch copy with the mark's name changed turns exactly the #4737 report arm red (16 pass, 1
fail by name); a scratch copy without the new `cert-first-fetch` pattern turns exactly its classify case red.

Inert alone: nothing writes the `held` mark until the relay half (kosmos-relay `heldcert-4737`) ships, and that half
reaches people only in an app cut, which by then carries this one. Merge order: this branch first.
