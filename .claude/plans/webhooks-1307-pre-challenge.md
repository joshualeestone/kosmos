---
pre_challenge: true
method: challenge-loop
branch: webhooks-1307
diff_hash: b0a9c1458ba71a4147b9c0cfd33499d159fefdfe1c4d4ef3c7b571fea1a70fd1
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T01:12:48Z
iterations: 15
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 15 (1 to 8 in an earlier session, whose fixes are the commits titled "address challenge-loop iteration 1..8 findings"; 9 to 15 in this session, detailed below)
**Converged:** Yes, at iteration 15 (zero NEW findings after deduplication, no ASKED findings)
**Findings this session (iterations 9 to 15):** 2 BLOCKER-class correctness fixes, 9 WARNINGs actioned, 1 CONVENTION, NITs listed below
**Fixed:** 10 | **Deferred:** 7 (with reasoning) | **Asked (awaiting user):** 0

Note on the earlier session: its per-iteration ledger did not survive the session restart. Its fixes are on the branch as commits, and every later reviewer read the full diff, so nothing it fixed is unreviewed; only its bookkeeping is missing here.

### Per-Iteration Breakdown

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 1 of the above (engine/webhooks.js:231, a comment written by iteration 5's fix)
- [WARNING] engine/webhooks.js:231 - verify's cache could keep a DELETED webhook verifying if a delete and a same-size write landed in one mtime tick on a reused inode; the comment claimed a miss cost only a stale name --> FIXED (1338291): a count of this process's own writes is part of the cache key; the false comment deleted; test freezes the file's stat, deletes, asserts the link stops verifying; mutation control (counter removed) goes red
- [WARNING] engine/tasks.js:360 - give-out comment read as an absolute guarantee --> FIXED (1338291), reworded to what the code checks (made.via)
- [WARNING] engine/webhooks.js:187 - touch() rewrites the store per call, defeating the cache --> DEFERRED: bounded by 30/min per webhook and 120/hour per project; the cache comment is conditional and accurate
- [CONVENTION] .claude/plans/webhooks-1307.md - no timestamp in plan name --> DEFERRED: matches every plan in this repo and the gate's own lookup
- [NIT] server.js:15990 - inner `ours` shadowed the 503 helper --> FIXED (1338291), renamed ourTrouble at both sites, flags made consistent

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 0
- [CONVENTION] server.js:15867 - the #3861 docblock was separated from its handler by the webhook blocks --> FIXED (2335da9), moved back beside taskParent
- [WARNING] server.js:1041 - HOOK_BODY_MAX may refuse an ASCII-escaped maximal body --> DEFERRED with a check: an emoji counts as two units against the limits, so escaping costs at most 6 bytes per counted unit (about 14.5 KB with title, text and detail at their limits); a test now sends that worst case and gets 201 (2335da9). The tunnel shares the 16 KiB cap (relay#195), so the cap must not move on one side alone.
- [NIT] engine/webhooks.js:127 - name accepted U+2028/U+2029 --> FIXED (2335da9), with test cases

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (new), 0 CONVENTIONs
**Self-generated:** 0
**Duplicates of prior findings:** 2 (rate budget before body: plan's accepted trade-off; touch cost: iteration 9 deferral)
- [WARNING] server.js:15887 - early 429/404 leave an unread body on a keep-alive socket --> DEFERRED, measured: after an early 404 with 8 KB unread, a second request on the same socket is answered correctly (Node discards the unread body)

#### Iteration 12
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] web/index.html:50993 - a read error stayed beside a correct list after a later good read --> FIXED (d91ba31): cleared on a good read only if it is still the read error; page test covers both arms
- [WARNING] server.js:1066 - the hourly 429 said "tasks" though refused calls count --> FIXED (d91ba31), says "calls from its webhooks"
- [NIT] plan test count stale --> FIXED (d91ba31), count removed
- [NIT] `waiting` counted all open webhook tasks --> FIXED (d91ba31), renamed openFromHooks

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (new), 0 CONVENTIONs
**Self-generated:** 0
**Duplicates:** 2 (rate budget, touch cost)
- [WARNING] server.js:15900 - a title with an emoji sequence (family, skin tone at a laptop) was refused: its zero-width joiner is Unicode Cf --> FIXED (eb0280b): the joiner passes only between two emoji; test covers accept and refuse arms; mutation control (old rule) goes red
- [WARNING] engine/tasks.js:347 - detail is not quoted for agents --> DEFERRED: no agent-facing line carries detail (forAgent covers the pane line and task list; neither CLI prints detail); the raw /api read is the plan's stated residual

#### Iteration 14
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING (re-found), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 (blame BRANCH)
**Duplicates:** 1 (rate budget)
- [WARNING] engine/tasks.js:361 - iteration 9's rewording still said an agent "is refused" outright --> FIXED (bcfd730): says made.via rests on the advisory isViaScreen check and that forAgent's marks are the protection that holds
- Validation after this iteration: one red, engine/chat.dmnotice-4354.test.js swarm.pauseOf, a 1 ms timestamp difference under load 7.7, in a file this branch does not touch; green 3 of 3 alone; the 6j full run on this exact HEAD passed.

#### Iteration 15
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (3 WARNINGs, all duplicates of deferred entries: detail, rate budget, touch cost), 3 NITs
**Self-generated:** 0
**Converged** - no new actionable findings.

### Final Ledger (this session)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 9 | WARNING | engine/webhooks.js:231 | SELF | deleted webhook could verify from cache | FIXED | 1338291 |
| 2 | 9 | WARNING | engine/tasks.js:360 | BRANCH | absolute give-out comment | FIXED | 1338291 |
| 3 | 9 | WARNING | engine/webhooks.js:187 | BRANCH | touch rewrites per call | DEFERRED | bounded by rate limits |
| 4 | 9 | CONVENTION | .claude/plans/webhooks-1307.md | BRANCH | plan name has no timestamp | DEFERRED | repo practice |
| 5 | 10 | CONVENTION | server.js:15867 | BRANCH | #3861 docblock displaced | FIXED | 2335da9 |
| 6 | 10 | WARNING | server.js:1041 | BRANCH | body cap vs escaped JSON | DEFERRED | worst case measured, test added |
| 7 | 11 | WARNING | server.js:15887 | BRANCH | unread body on keep-alive | DEFERRED | measured, Node discards |
| 8 | 12 | WARNING | web/index.html:50993 | BRANCH | stale read error | FIXED | d91ba31 |
| 9 | 12 | WARNING | server.js:1066 | BRANCH | 429 says tasks, counts calls | FIXED | d91ba31 |
| 10 | 13 | WARNING | server.js:15900 | BRANCH | emoji ZWJ refused | FIXED | eb0280b |
| 11 | 13 | WARNING | engine/tasks.js:347 | BRANCH | detail unquoted for agents | DEFERRED | no agent line carries it |
| 12 | 14 | WARNING | engine/tasks.js:361 | BRANCH | iteration 9 fix still absolute | FIXED | bcfd730 |
| 13 | plan | WARNING | server.js:15887 | BRANCH | rate budget spent before body | DEFERRED | plan: known and accepted |

### NITs (non-blocking)
- server.js:373 forAgent collapses whitespace for all tasks (iterations 9, 10, 14)
- engine/webhooks.js:147 create checks the limit before the name (iteration 12)
- engine/tasks.js:141 forAgent assumes the task was given out (iteration 12)
- install/kosmos:2316 raw-JSON fallback is unmarked, but JSON-quoted on one line (iteration 14)
- web.api-routes-3957.test.js:435 substitution word widened (iteration 14)
- engine/webhooks.js:96 legacy projects with no createdAt skip the reuse guard (iterations 11, 15)
- the quote regex exists in three copies; cli.task-webhook-1307.test.js checks their agreement (iteration 15)
- pjsHookAdd replaces a revealed link without asking (iteration 10)

### Strengths
- Secret kept only as a sha256 hash, compared in constant time; unknown id, wrong secret and gone project answer the same 404
- Outside text marked and quoted at every agent-facing point, by Unicode class after NFKC, in three agreeing copies
- Checks beside the write (stamp, archived, open ceiling) with held-body and trickled-body tests; real body deadline
- Our own trouble answers 503 with Retry-After, never a 4xx a sender would treat as final
