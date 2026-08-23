---
pre_challenge: true
method: challenge-loop
branch: notify
diff_hash: 4bd663fd32187237267b2ddd5bd4ebca2eed8a2964fc8fed8ca576f2d9c5bbae
subdir_audit: passed
timestamp: 2026-08-23T18:55:16Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (bounded before it started)
**Converged:** No
**Total findings:** 10 (0 BLOCKERs, 6 WARNINGs, 2 CONVENTIONs, 2 NITs)
**Fixed:** 9 | **Deferred:** 1

### Iteration 1
- [WARNING] Settings copy omitted the install id the payload sends; the copy test could not catch it --> FIXED (copy names it; the test derives its phrases from the payload's keys)
- [WARNING] the reply hook fired before the record, so an unrecorded reply notified --> FIXED (after `kept.recorded === true`)
- [WARNING] the person's-post control never asserted the post went --> FIXED
- [WARNING] the under-test control had no positive half --> FIXED (guard lifted, one call; guard back, still one)
- [WARNING] no event id or session name in the contract --> FIXED (`id` = message id or reply key, `session`; documented in the plan)
- [WARNING] ping.installId writes ping.json on first use --> FIXED (documented in the payload comment as the one cross-feature write and why it is the same id)
- [CONVENTION] render-switch-states comment said four switches --> FIXED
- [CONVENTION] unknown kind dropped silently --> FIXED (one line to the board's log; a throw would be swallowed)
- [NIT] timer not cleared on a synchronous throw from the sender --> FIXED
- [NIT] HEAD answers with a JSON body, as the created-ping route does --> DEFERRED: matches the sibling; fixing one without the other is a new inconsistency

### Strengths (reviewer's)
- Privacy holds on every traced route: /api/post never passes operator, the person's post has its own route with no hook, text/attachment/trailer never reach the payload, the exact key set is asserted; read() is off for missing, unreadable and corrupt files and the UI says so.
