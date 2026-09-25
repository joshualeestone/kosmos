---
pre_challenge: true
method: challenge-loop
branch: assistant-bubble-3034
diff_hash: 9ee47ba7adbf78a2a0b906a790823c685fdfdbb0c8a5c4f901d6b9f735342a33
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T04:18:24Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11
**Converged:** Yes (iteration 10 had nothing at WARNING or above; iteration 11 reviewed the post-convergence merge,
trailers and avatar-pin change and found nothing at WARNING or above)

### Per-Iteration Breakdown (fixes in the commit of the same iteration)
- 1 opus: BLOCKER guide looked up once before it exists (re-find with backoff); reply dot on load; sendTalk clearing rules; silent Settings failure. B1b, B2 dot, B5b, B5c, B10.
- 2 sonnet: folded reads never re-validated the guide; open-race (confirm before every read and send); live region. B10 folded.
- 3 opus: 409 forgot the guide in a loop (only 404 forgets then); settings read retried; focus; nudge flash; per-guide reset. B12, B13.
- 4 sonnet: production-shaped slug fixtures; switch-on confirms first. Server slug test.
- 5 opus: BLOCKER (mine, from 3) every 409 kept the guide incl. not-guide; refusal reasons ('none','not-guide','unchecked'). B14.
- 6 sonnet: README row stale.
- 7 opus: MEASURED the bubble on an agent page's Send button: asbLift; Help box survives unreadable tips. B15, B16.
- 8 sonnet: lift capped to the window; switch held until confirmed. B17.
- 9 opus: BLOCKER guide matched by display name too (a person's own "Josh" as josh-2); refused send says so; band rule. B2b, B19; B2b/B17 re-aimed after their negative controls passed.
- 10 sonnet: nothing at WARNING or above. Converged.
- 11 opus: post-convergence merge (Renet's /api/setup-guide/hosted beside GET /api/setup-guide), trailers, avatar pin 20->21: clean.

### Declined
- The hosted no-guide chat (Renet's #3674): a separate follow-up PR; today it answers 501 on every install (on the card).

### Validation
Surface gate: trailers for render-consolidated-newagent-3053.js, render-agentdm-3414.js, render-help-tips-3574.js (all
run green unchanged). web.avatarver-2762 pin 20 -> 21 (the assistant's picture is versioned). Two contention reds
(tools.release-gate #1455 while Baron's install harness ran; engine/updating-988 at load 11 on 10 cores) each passed
alone repeatedly; final 6j PASSED on 6f543cbc's content (record hash 9ee47ba7).
