---
pre_challenge: true
method: challenge-loop
branch: listfail-9085
diff_hash: bf8241a748c133d366a5f8b6116dca0ddcb80b92821b96815908cac431e6ab39
validation: passed (Mortals)
timestamp: 2026-11-26T03:32:51Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the round limit; one blind reviewer at a time, models alternated)
**Converged:** No. Round 8 raised no BLOCKER; its remaining points are recorded below, not fixed.
**Validation:** full suite on Mortals at 27db5fa69c, 21:31 CST 11-25: rc 0, entry status clean, remote hash equal to the
local diff hash above, all four shell shards green.

The per-round history lives in .claude/plans/listfail-9085.md ("Decision", "Rejected" and the review notes inside
them). The original per-round scratch ledger was in a session scratchpad that did not survive a restart, so this file
summarises from the plan rather than copying the rounds verbatim.

#### Iteration 1
- [BLOCKER] engine/win32roster.js - listing a supervised agent inside win32roster.make on a failed read made a partial
  roster read as complete to remove, restart's fromDead and create's clash check --> FIXED: reverted (edcc3a5a7b), the
  send gate answers an unreadable roster instead.

#### Iterations 2 to 7
- [WARNING] server.js send gate - a 503 reads as "it may have gone" on the board and the iPhone --> FIXED: a 409 with
  because 'unreadable' and retry true (round 2).
- [WARNING] server.js - a name store.safeKey cannot key was read as "could not look" --> FIXED: only "not ours" (round 4).
- [WARNING] server.js - two roster reads could disagree --> FIXED: decided in ONE read; a codex-kept roster with a failing
  Claude read asks win32roster's cachedRun.problem() (round 5).
- [WARNING] server.js - a typo was told to retry for hours --> FIXED: that arm needs no card holding the name and a live,
  unremoved agent folder here (round 6), and the folder check gates both arms (round 7).

#### Iteration 8 (whole branch)
- [NIT] server.dm-listfail-9085.test.js - the unkeyable-name control cannot tell the two safeKey readings apart.
- [NIT] a just-created agent's first message, with a failing Claude read, gets the 409 at once, not the #8652 wait.
- [NIT] retry: true rides only the unreadable 409; no client reads it on this route yet.
- [NIT] one log line per refused send, no rate limit.

### Final Ledger
Fixed: the round 1 BLOCKER and the round 2 to 7 WARNINGs above. Deferred: the four round 8 NITs, and three other
routes that still 404 an unreadable roster, listed on kosmos#9087. Weakest premise: that the chat listener retries a
409 as it retried the 404 (outside this repo, not read).
