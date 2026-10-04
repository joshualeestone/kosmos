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

### Per-Iteration Breakdown
#### Iteration 1 (opus): 3 B, 3 W, 4 N
- [BLOCKER] engine/fedmembers.js: new owner link stamped with the invite time; fedseats.stampOf reads it as an earlier project's and forgets it --> FIXED: the project's createdAt; server test asserts fedseats.linkFor accepts it
- [BLOCKER] engine/fedmembers.js ownerLinkOf: a stale link of an earlier project of the same id reused --> FIXED: forgotten first with its room keys and rows; tested
- [BLOCKER] engine/fedmembers.js invite: two invites at once mint two refs --> FIXED: per-project chain; tested
- [WARNING] the seat not started after a new link --> FIXED: fedseats.ensure after a 200
- [WARNING] a removed project's invite rows survive into a reused id --> FIXED: fedmembers.forget on remove and create; tested
- [WARNING] Withdraw's 404 match too broad --> FIXED: keyed on the coordinator's own sentences
- [NIT] Members answers for a removed project --> FIXED: 404; [NIT] a doc comment moved onto the wrong route --> FIXED; [NIT] plan count --> FIXED; [NIT] a test name --> FIXED
#### Iteration 2 (sonnet): 0 B, 1 W, 3 N
- [WARNING] a link recorded by another path during the await is overwritten --> FIXED: re-read; 409 'changed'; tested
- [NIT] project_name fallback to the request's --> FIXED; [NIT] a read can forget a stale link --> STATED in a comment; [NIT] mutations not re-run --> listed in validation
#### Iteration 3 (opus): 0 B, 2 W, 3 N
- [WARNING] create-screen joiners invisible and unremovable; my plan premise false --> FIXED: unrecorded connections listed; plan corrected; tested
- [WARNING] made_at in ms, expires_at in s --> FIXED: seconds everywhere; tested
- [NIT] room line owner unclear --> FIXED: the board writes it; [NIT] description from the request --> FIXED: from the board; [NIT] refused code's stash --> fixed in round 5
#### Iteration 4 (sonnet): 0 B, 1 W, 2 N
- [WARNING] a long board description refuses every invite --> FIXED: cut to the bound; tested
- [NIT] two sort orders --> FIXED: one; [NIT] unrecorded rows share invite_id --> STATED: key by edge_id
#### Iteration 5 (opus): 0 B, 2 W, 3 N
- [WARNING] a refused code's sealing half stays stashed --> FIXED: unstash on every refusal; tested
- [WARNING] the cut can split an emoji --> FIXED: whole characters within the UTF-16 bound; tested
- [NIT] unreadable record reads as 'changed' --> FIXED: 500; [NIT] removed project mid-invite --> FIXED: 404; [NIT] read can delete --> STATED
#### Iteration 6 (sonnet): 0 B, 0 W, 3 N. Converged.
- [NIT] the 500 path's unstash untested --> FIXED: test; [NIT] cut helper per call --> FIXED: hoisted; [NIT] leftover sealedRefs flag for an unused ref --> STATED: harmless, nothing enumerates it
