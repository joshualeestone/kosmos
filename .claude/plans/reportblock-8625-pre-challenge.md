---
pre_challenge: true
method: challenge-loop
branch: reportblock-8625
diff_hash: b486b4e2cd654db6189a35c85e1b73112125e4c1970e58798b4c982963042439
validation: failed in the full run on two load-timed tests outside this diff (engine/connect.test.js #458, server.slowrequest-runner-8191.test.js); both pass run alone; everything else green; CI's full run is the gate
subdir_audit: passed
timestamp: 2026-11-17T16:47:38Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, stopped at the 8-round cap (the standing rule: cap 8 unless a BLOCKER is open). No BLOCKER open at the stop.
**Converged:** No, stopped at the cap with WARNINGs left; each is recorded below and on #8625 (issuecomment-6952922639).
**Total findings:** 4 BLOCKERs, 28 WARNINGs, 4 CONVENTIONs, about 30 NITs across 8 rounds.
**Fixed:** all 4 BLOCKERs and most WARNINGs | **Deferred or accepted:** listed under each round | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] ios/Kosmos/ComposerExtras.swift Block's question vanished in the keyboard panel --> FIXED (host asks, as Delete)
- [WARNING] own-computer posts offered Report/Block --> FIXED (sameAccount kept, hidden, refused)
- [WARNING] report could not name the sender --> FIXED (sender route)
- [WARNING] no mail app, silent --> FIXED (copy fallback)
- [WARNING] blocked flood spent the room budget --> FIXED (fedseats early drop, control test)
- [WARNING] wording vs scope --> FIXED
- [WARNING] unread counts --> FIXED
- [CONVENTION] plan's kosmos room claim --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] "+" in the mail link --> FIXED (strict encoding, raw-link test)
- [WARNING] no Report/Block in the archive view --> FIXED
- [WARNING] older own-account rows blockable --> FIXED (account fallback)
- [WARNING] quiet-run logic sees old rows --> recorded

#### Iteration 3
**Reviewer model:** opus
- [WARNING] room route never sent sameAccount --> FIXED (shared helper, route test)
- [WARNING] sender route lacked the fallback --> FIXED
- [WARNING] every refusal said try again --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] unreadable list could be saved over --> FIXED (refuse; byte-for-byte test)
- [WARNING] filter moved the archive split --> FIXED (after the split; archive tests 45 pass)
- [WARNING] terms for 1.2 --> routed (site respect-8625)

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] blocked rows stayed on the phone (merge only adds) --> FIXED (hidden ids; merge test with premise)
- [WARNING] flood file I/O --> FIXED (cache); [WARNING] desktop UI --> #8631; own account on ship day --> accepted

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] stale cache after a write --> FIXED; [WARNING] Unblock did not come back --> FIXED; [WARNING] archive reads --> FIXED

#### Iteration 7
**Reviewer model:** opus
- [BLOCKER] my round 6 replace-all made hiddenIn recurse forever (every room open would crash) --> FIXED and read; no check here catches it (typecheck of the broken copy reports nothing, measured)
- [WARNING] reset kept block ids --> FIXED; [WARNING] unreadable 2xx wording --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 3 NITs. Stopped at the cap.
- [WARNING] observer has no deinit --> recorded (store lives as long as the app)
- [WARNING] Unblock does not re-read open rooms --> recorded on #8625
- [WARNING] unreadable list fails open, unannounced --> recorded on #8625
- [WARNING] agent-side context reads rows kept before a block --> recorded

#### Final validation (6j)
- First run: two #1732 guards flagged `split(':')` --> FIXED (indexOf), guards pass.
- Second run: engine/connect.test.js (#458 cancel timing) and server.slowrequest-runner-8191.test.js (#8191 slow-request control) failed under load; neither file is in this diff; both pass run alone (105/105 and 3/3 with one skip each). Recorded as not passed here; CI's full run on the PR decides.

### Outstanding questions
- None.
