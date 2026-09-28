---
pre_challenge: true
method: challenge-loop
branch: internalflag-4253
diff_hash: 83c7c2da5abddcb01fbca61c0f65861516e29b9117b459bac61b040df039bd7c
validation: red-outside-this-branch
subdir_audit: passed
timestamp: 2026-09-28T15:32:13Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (one review covered both repos' halves of rule C)
**Converged:** Yes (iteration 2: nothing new)
**Total findings:** 5 (1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 1 NIT)
**Fixed:** 3 | **Deferred:** 1 | **Asked (awaiting user):** 0 | **NIT noted, not acted on:** 1

**Final gate:** kosmos full suite 11,096 pass / 0 fail. Two reds: the #4273 leak guard caught this branch's
own test leaking a temp dir (FIXED, 7738a3b1a, proven both ways), and test-tunnel-handshake-gate, which fails on
untouched origin/main as well (53/0 then 35/18 on consecutive runs; #4352). createdbeacon-3038 11/11. Site half:
api 209/209 and em-dash guard PASS (merged as site #159).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [BLOCKER] site created.js record logic untested --> FIXED (api/_createdcore.js, injected store, tested)
- [WARNING] a failed internal listing failed the ping --> FIXED (read as empty, logged)
- [WARNING] the shared unknown record could move --> FIXED (never moves)
- [WARNING] internal installs vanish from /admin --> DEFERRED (recorded in the plan)
- [NIT] a file read per ping --> NOTED

#### Iteration 2
**Reviewer model:** sonnet
- nothing new (checked the refactor for drift: body keys and order, put options, tokens, 400/405/500, old-shape migration)

**Hold:** no machine is marked internal until Josh picks the public numbers (Splinter, 09:58 CDT).
