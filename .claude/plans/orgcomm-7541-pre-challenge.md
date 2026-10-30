---
pre_challenge: true
method: challenge-loop
branch: orgcomm-7541
diff_hash: 3b4f5ff7bbd337d30aa60cac704365036b874986d6ebf765fe1fd9d92d496e29
validation: passed
subdir_audit: passed
timestamp: 2026-10-29T06:38:41Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11 (iteration 1 the first full suite; iterations 2 to 11 blind reviewers on the skill's template, alternating opus and sonnet)
**Converged:** Yes (iteration 11 found nothing new: its warnings duplicate decided entries)
**Total findings:** 1 BLOCKER, about 30 WARNINGs, 4 CONVENTIONs, many NITs (per round below)
**Fixed:** the BLOCKER and every WARNING not decided below | **Deferred:** decided items, reasons below | **Asked:** 0

**Validation of record (HEAD 187f1ba172, rebased on origin/main, 01:19 to 01:38 CDT, through the machine's heavy-work queue):** tools/run-tests.sh exit 0: 25626 node tests with 0 failing, and all four shell shards status 0. Each round's fixes carry a test and a mutation control that reds it (the send-time switch, the company space only, the lost-answer recovery, the cross-company hold, the joined-space check, the 404 take-down checks, the comment guards, the route's space, the delivered-policy read). Two earlier full runs had load timeouts in unrelated files (remote, supervisor, create, server.agent-id), each of which passed alone.

### Per-Iteration Breakdown

#### Iteration 1 (first full suite)
**Reviewer model:** none. One failure: engine.reachable flagged setRemote, a test seam, excused with a reason.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 2 CONVENTIONs
- [BLOCKER] engine/communitysend.js: public_community off checked only at store time --> FIXED (send-time check)
- [WARNING] edit/withdraw of a company post via public routes --> FIXED (refused, later the space DELETE)
- [WARNING] --kosmos-bug went to the company space --> FIXED (public, refused when off)
- [WARNING] not_in_space / 404 marked refused --> FIXED (waits)
- [WARNING] 503 path untested --> FIXED (test)
- [WARNING] CLI said goes public for a company post --> FIXED (both CLIs)
- [CONVENTION] stale plan; misplaced comments --> FIXED

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs
- [WARNING] edits refused for unsent company posts --> FIXED
- [WARNING] a company post waits forever when the company turns it off --> DEFERRED to #7543 (fails closed)
- [WARNING] person's Delete promised minutes --> FIXED (space DELETE, Renet's contract)
- [WARNING] 3b ordering not enforced --> written on #7540

#### Iterations 4 to 10
**Reviewer models:** opus, sonnet, opus, sonnet, opus, sonnet, opus
- [WARNING] policy read without applying a delivered one --> FIXED (inForce)
- [WARNING] public comments under off; comment on a company post --> FIXED (held, logged once)
- [WARNING] sent record lacks the space; per-comment file reads --> FIXED
- [WARNING] a company post could go into another company's space after a move --> FIXED (org on the post, memberships per agent and company, hold)
- [WARNING] board's open feed showed company posts --> FIXED (filtered)
- [WARNING] flag reset, fling retry, log floods --> FIXED
- [WARNING] joined space never compared with the post's company --> FIXED (sameOrg, Renet 00:01)
- [WARNING] 404 take-down while spaces off; still listed --> FIXED (space must answer, post absent)
- [WARNING] no pause after a pass failure; site without spaces --> FIXED (10 min, per agent and company)
- [WARNING] per-item policy memo vs send time --> FIXED (switch per item, inForce once per sweep)

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 (three warnings, each a duplicate of a decided entry; one plan sentence made exact)
**Converged.** No new actionable findings.

### Final Ledger (decided, not missed)

| # | Category | Description | Status | Reason |
|---|----------|-------------|--------|--------|
| 1 | WARNING | A post stored public before the company turned its own on goes public | DEFERRED | Written when the public community was the only one; tested |
| 2 | WARNING | A damaged enrollment or policy record refuses posts and holds public sends on any board | DEFERRED | Fails closed on purpose; tested; stated in the plan |
| 3 | WARNING | Under off an agent is still registered on the public site | DEFERRED | Space calls need its session token |
| 4 | WARNING | Reads, comments, votes, follows, profile, waiting words, edits in a space | DEFERRED | #7543, which must land before #7540's switch reaches a real company |
| 5 | WARNING | A company post or take-down waits forever after its company turns it off | DEFERRED | Fails closed; dropping it with a sentence is #7543 |

### NITs (non-blocking)
- [NIT] usage string repeated in install/kosmos; waitSaid never pruned; COMPANY_NOT_YET used once; membership expiry has no skew margin

### Strengths
- The space is decided by the route from the policy, never the candidate; every path out (send, recovery, take-back, edit, comments, the open feed) is closed for company posts, and a company post goes only into its own company's space
