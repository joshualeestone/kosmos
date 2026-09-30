---
pre_challenge: true
method: challenge-loop
branch: allowpoll-4640
diff_hash: f2806af4510dbd3a9b5be26ed7c4ca01a0cf1718857d75330934a40cf82e6b8c
validation: pending (full validation queued on Mortals for this head)
subdir_audit: passed
timestamp: 2026-09-30T21:48:44Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (blind, sonnet), 2026-09-30. Round 3 reviewed the merge with main after main reverted #4638 (f9da236c9).
**Converged:** Yes (iteration 3: 0 BLOCKER, 0 WARNING, 2 NIT)
**What ships:** a new second computer waiting for its Allow shows a grey "Waiting to be allowed" pill and the coordinator's own sentence, not "Kosmos+ refused this Mac: ... (HTTP 403 ...)". This was measured today as exactly what production shows on 0.7.11. The engine's allow-watch is kept but has no caller until #4754.

### Iteration 1 (waiting-allow build): 0 BLOCKER, 1 WARNING, 3 NIT
- [WARNING] code own_lineage alone counted as waiting, but the coordinator also sends it with two FINAL sentences (denied; no computer left to allow) --> FIXED: the wait sentence is required; controls for both final sentences; a mutation reds the new control
- [NIT] the sticky waiting state could mask a dial that hangs after the Allow (bounded) --> NOTED
- [NIT] the pill could alternate with Connecting if the tunnel exits between retries --> NOTED
- [NIT] signin-allowed-done had no cross-site guard (it only drops a token) --> NOTED
### Iteration 2 (earlier rounds of the sign-in allow-watch, recorded in the plan): converged
### Iteration 3 (the merge after the #4638 revert): 0 BLOCKER, 0 WARNING, 2 NIT
- Verified: nothing left calls reverted #4638 code; every consumer of status().state handles waiting-allow; the matcher needs the wait sentence; the kept allow-watch is inert with no caller (no timer, no token held) and guarded against other sites.
- [NIT] about 120 lines of engine allow-watch wait for #4754 to call them
- [NIT] the new report code 'waiting-allow' goes to the coordinator; confirm it accepts an unknown error code

### Tests
engine/remote.test.js 132/132 (twice, alone; one run beside the other two files had a single #3827 timing red at 13 s under load 5.5, and it passed alone twice), remote-report 15/15, server 346/346, webhooks-1307 39/39; render-plus-panel-3829 118 PASS, render-plus-signin-3478 175 PASS.
