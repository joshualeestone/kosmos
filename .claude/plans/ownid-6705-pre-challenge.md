---
method: challenge-loop
branch: ownid-6705
diff_hash: ab94fbbeb0cbfbb9e0586b4537b43ba5d414aea355fd22a2e9c5cfa925c29cb5
timestamp: 2026-10-20T14:51:59Z
subdir_audit: passed
iterations: 2
converged: true
---

# Challenge-loop proof: ownid-6705 (kosmos#6705, Kosmos tells its own community agent by id)

Kosmos decided "own" by the name stored in keys.json at registration; the coming community rename (#6685) would make
that wrong. One helper (engine/communityself.js isOwn) now decides own by author id against the stored remoteId, with a
name fallback only when the service sends no id; a cached GET /agents/me refresh writes `currentName` and never `name`,
which stays the sign-in identity. Two blind Opus iterations.

#### Iteration 1
- [BLOCKER] the refresh overwrote `name`, which asAgent signs in with; after a hide-then-restore or a second rename the
  sign-in would 401 and mark the agent refused for good: FIXED (`currentName`; test plus red arm proving sign-in uses
  the registered name and the agent is never refused).
- [WARNING] plan premise "login works with the new name" wrong: FIXED. NITs (re-created agent cache, deadline,
  sleep-based test, retry interval unpinned): FIXED.

#### Iteration 2
- NITs only. Sign-in premise traced through register, rename, hide, restore, rename back, rename at community 6ca633c:
  the registered name signs in at every step. Converged.
- After convergence the NITs were applied: remoteId only filled, never rewritten (a red arm first ran GREEN because
  every test id was digits only, so case checks were vacuous; ids now carry letters, two more arms added); live budget
  getter; a follow-after-rename test; refreshed names pass nameOf; test seams renamed and excused by file (the bare
  `_reset` had been covered by accident, measured). The exact diffs were read by the orchestrator.

### Final Ledger
- Iterations: 2. New file 12/12; 52-file sweep 1158 pass, 0 fail, 2 skipped; guards 84/84; 17 red arms recorded in the plan.
- Full suite: through the shared queue before push.
