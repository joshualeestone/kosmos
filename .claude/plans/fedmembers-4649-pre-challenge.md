---
pre_challenge: true
method: challenge-loop
branch: fedmembers-4649
diff_hash: 5d16d6d324f8f48052728b58dce43e8fb4af3cc73b7ec9702b6d91211688f31d
validation: engine/fedmembers.test.js, server.fedmembers-4649.test.js, engine/federation.test.js, server.federation-3311.test.js 67/67 at the final code. Mutations, each red on its own test: Remove without the project check; the label sent to the coordinator; Members without the screen gate; the invite-time stamp; no stale-link forget; no per-project serialization; no forget on project removal; no re-read before the late link write; no listing of unrecorded connections; no clamp; no unstash (409, 404 and 500 paths). Full suite on Mortals and full browser checks (server.js): pending.
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-04T17:31:36Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind rounds (opus, sonnet alternating). **Converged:** Yes, at iteration 6: 0 BLOCKER, 0 WARNING, 3 NIT (one test gap closed, one helper hoisted, one stated).
**Disclosed against this work:** round 1 found three BLOCKERs in my first build: the new owner link was stamped with the invite time, so the seat check would have forgotten it within 60 s (a guest would join a room nobody sat in); a link left by an earlier project of the same id would have been reused; two invites at once minted two refs. Round 3 found that my plan's premise about create-screen invites was false (they are never recorded, so their joiners were invisible and unremovable). I also wrote a regex with literal U+2028 characters that broke the module's syntax, caught by node --check before any commit.
**Tallied:** 3 BLOCKER (all fixed), 8 WARNING (7 fixed, 1 stated: a GET can forget a STALE link, as the own-code route does), 16 NIT.
**Every fix has a test that reds when the fix is removed (listed above).**

Per-round detail is in .claude/plans/fedmembers-4649.md ("Review round N" sections).
