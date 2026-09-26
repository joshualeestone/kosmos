---
pre_challenge: true
method: challenge-loop
branch: guidecount-3894
diff_hash: f581dfd9092e6fbd3fea731428e052244727c818ff1efa64e9c6073df2b633ec
subdir_audit: passed
timestamp: 2026-09-26T04:46:25Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (a comment-only change recording a decision; every claim in the comment was measured on origin/main).
**Converged:** Yes.

## Iteration 1
- [STRENGTH] Claim "createAgent writes its birth to created.jsonl" is measured: `recordBirth` is called at engine/create.js:3836, inside `function createAgent` (starting line 3831).
- [STRENGTH] Claim "the guide is made through that createAgent" is measured: both production callers pass `createAgent: create.createAgent` (server.js:10241 first-run, server.js:16068 model-connected). Only tests inject a fake.
- [STRENGTH] Claim "the beacon sends createdCount(), the total from that log" is measured: create.js:3508 counts CREATED and PARTIAL lines in created.jsonl; createdbeacon.js's header says the created ping carries TOTAL-EVER-CREATED from the birth log.
- [WARNING] The card's premise ("the guide agent is created and never counted") is therefore only true for an install whose person never creates a second agent with the box on. Accepted: that install's homepage count then misses one guide, which is the conservative direction for a public counter.
- [WARNING] No test pins "the guide lands in the birth log"; the seed tests inject a fake createAgent. The pinned facts are in create.js and server.js, and a test would need a full sandboxed create. Disclosed rather than built.
- [NIT] The alternative (ping from the guide path) was rejected: it would send the count at a moment the person made no choice, which is the checkbox's job (Josh's #3038/#3877 ruling keeps the ping and its default-on box together).
- [CONVENTION] No em dashes; setup-assistant tests 6/6 and engine.setup-assistant-3034 38/38 pass.

## Weakest premise
- That "agents created" should include agents Kosmos made for the person. If Josh wants only person-made agents counted, the fix is to skip `createdBy: 'kosmos'` rows in createdCount (one filter), which this comment would then need to say.
