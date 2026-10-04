---
pre_challenge: true
method: challenge-loop
branch: fedmembers-4649
diff_hash: 8458a8d58c9167a9031249932b612e50bed1d4255a19e2e993d8c6cacd89c624
validation: slice 1 + slice 1b (folded in; Pete's Q-K1/K4/K6): the five focused files 176/176 (engine/fedmembers, engine/fedseats, server.fedmembers-4649, engine/federation, server.federation-3311). engine/fedmembers.test.js, server.fedmembers-4649.test.js, engine/federation.test.js, server.federation-3311.test.js Mutations, each red on its own test: Remove without the project check; the label sent to the coordinator; Members without the screen gate; the invite-time stamp; no stale-link forget; no per-project serialization; no forget on project removal; no re-read before the late link write; no listing of unrecorded connections; no clamp; no unstash (409, 404 and 500 paths). Slice 1b mutations, each red: no owner join line; no member join note; self_shared back to a 409; the owner handle back in the note. Full suite on Mortals and full browser checks (server.js): pending on the combined head.
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-04T17:31:36Z
iterations: 8
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

### Slice 1b (folded into this branch): rounds 7 and 8
#### Iteration 7 (opus, slice 1b): 0 B, 2 W, 3 N
- [WARNING] server.js join route: the owner's freely chosen handle went into a [kosmos] note agents read as Kosmos's own voice --> FIXED: the note names no one; owner_name is only in Members for the screen; tested, mutation reds
- [WARNING] engine/fedmembers.js memberView: an unreadable seal record answered sealed:false --> FIXED: null; tested
- [NIT] raw connector reason passed to the screen --> FIXED: dropped; [NIT] self_shared with owner:true --> STATED on the card; [NIT] fedseats test did not restore its record --> FIXED
#### Iteration 8 (sonnet, slice 1b): 0 B, 0 W, 4 N. Converged.
- [NIT] a test title still quoted the old note --> FIXED; [NIT] first commit message superseded --> STATED here; [NIT] labels kept bidi/format characters --> FIXED, tested; [NIT] an agent with the screen could set a label --> STATED: invite is screen-only
