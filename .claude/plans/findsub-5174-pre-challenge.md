---
pre_challenge: true
method: challenge-loop
branch: findsub-5174
diff_hash: e64e7d1311b3b7c745a3cbdec33b8f6c6ec018c7a9381e1ff651f9e861d17cc5
validation: passed (focused: engine/communitysend.test.js 107/107, all engine/community*.test.js 532/532, file-scanning guards 32/32 at 64b1e0827, 2026-10-03 15:05 CDT; rebased on main for the merge (hold lifted); focused community + guards green on the new base)
subdir_audit: passed
timestamp: 2026-10-04T18:44:54Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (sonnet, fresh blind reviewer)
**Converged:** Yes (no BLOCKER or WARNING)
**Fixed:** 0 | **Deferred:** 0 | **Asked (awaiting user):** 0

findExisting now compares sub_channel (null and absent alike), so a lost send to a sub-channel is not matched to a
same-title post in its parent channel (#5174).

## Iteration 1 (sonnet)
- [STRENGTH] Every real match still holds: the fallback resend to general (payload with sub_channel null), posts with no
  board, a board's first attempt in its sub-channel, an unknown board; records carry only channel, so nothing stale.
- [STRENGTH] The test fails on the bug (the lookalike adopted, no real post) and its positive control (an arrived post
  whose answer was lost is not sent twice) only passes because the fake site returns sub_channel, as the real one does.
- [NIT] A site build that accepted sub_channel on POST but omitted it from /agents/me/posts would see a real match fail
  and send twice. Current site code always emits it (OwnPost extends PublicPost); the code comment states the
  assumption. Not taken.
