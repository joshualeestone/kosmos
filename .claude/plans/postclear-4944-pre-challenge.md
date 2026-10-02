---
pre_challenge: true
method: challenge-loop
branch: postclear-4944
diff_hash: 76c6bcfa83187b34d1090f639d44d2284c274509aee174c2c9af28d31b07bbff
validation: passed (Mortals full suite + focused + browser checks)
subdir_audit: passed
timestamp: 2026-10-02T02:20:04-05:00
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12 (10 to convergence; 2 more after the queued browser check measured a 17px jump)
**Converged:** Yes
**Fixed:** every BLOCKER and WARNING; one pre-#4944 behaviour deferred (a could_not recorded row's retry copy) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] no-bubble empties box -> FIXED a3b6983
- [WARNING] adjacent-reply case vacuous -> FIXED (case 13)
- [WARNING] could_not vs catch rules -> FIXED (comment)
- [CONVENTION] README row -> FIXED
- [NIT] : announcer stale (fixed), undo history, header Run line (fixed)

#### Iteration 2 (sonnet)
- [BLOCKER] placed with no bubble leaves words armed -> FIXED b0524e6 (SELF)
- [WARNING] restored words not re-parked -> FIXED
- [WARNING] loose drawn selector -> FIXED
- [WARNING] retyped draft retired -> FIXED
- [WARNING] could_not recorded restores -> DEFERRED (pre-#4944 behaviour, retry copy; case 14)
- [CONVENTION] plan -> FIXED

#### Iteration 3 (opus)
- [WARNING] catch restores after placed throw -> FIXED 069fe3d
- [WARNING] moved-flight draft retire -> FIXED
- [WARNING] unconfirmed line untrue -> FIXED
- [WARNING] untested arms -> FIXED (17-19)
- [NIT] chain adjacency -> FIXED, timer token -> FIXED

#### Iteration 4 (sonnet)
- [WARNING] not in gated.txt -> FIXED 74f4005
- [WARNING] could_not/catch line ignores restore -> FIXED (dmNotSentWhere)
- [CONVENTION] plan gated -> FIXED
- [NIT] sendGen, header, case 12/19 -> FIXED

#### Iteration 5 (opus)
- [WARNING] unconfirmed says not sent -> FIXED 6e485f9
- [WARNING] untested announcer/throw/no-bubble unconfirmed -> FIXED (21-23)
- [NIT] shared adjacency helper -> FIXED

#### Iteration 6 (sonnet)
- [WARNING] no Sending line without bubble -> FIXED b4ec68c (SELF)
- [WARNING] catch after non-delivered verdict -> FIXED
- [NIT] case 22 discriminating -> DEFERRED (it is: restore would refill the box)

#### Iteration 7 (opus)
- [BLOCKER] case 17 asserts removed sentence -> FIXED fdd02b0 (SELF)
- [WARNING] pill vs line -> FIXED (Not confirmed)
- [WARNING] delivered includes could_not -> FIXED
- [WARNING] attachment-only line -> FIXED
- [NIT] rawBox, case 22 throw proof, plan numbering -> FIXED

#### Iteration 8 (sonnet)
- [WARNING] "back in the box" when retyped -> FIXED 96a5085
- [WARNING] could_not recorded -> DUP of deferred

#### Iteration 9 (opus)
- [WARNING] Sending announced twice without bubble -> FIXED 45e5298 (SELF)
- [WARNING] could_not recorded -> DUP of deferred
- [NIT] comments -> FIXED

#### Iteration 10 (sonnet)
- No new issues found. 0 new. W timing/layout not yet run -> DUP of deferred fixed-sleep NIT; settled by the queued run. NIT could_not recorded says "marked not sent" (pill reads Could not deliver) -> open NIT.

#### Iteration 12 (sonnet)
- No new issues found. 0 BLOCKER, 0 SHOULD-FIX = CONVERGED on the height fix. NITs taken: the kept arm's vacuous pill test reads the slot; the unit test pins Sending… to <span class="msg-t">.

Post-convergence: the queued browser check ran and measured the pending "Sending…" pill 17px taller than the kept row; fixed in f8ee860a6 before iterations 11 and 12.

### Validation
- Mortals full suite on 45e52981d: 13678 pass, 0 fail. Its only red was the browser-check surface gate (16 DM checks mapped
  to d-dmthread/msg). Since then only the pending bubble's status slot, its comment, two browser checks and one unit test
  changed.
- Agent1s b-4944 on 75962edc3 (02:15-02:19): all 20 DM browser checks rc 0 (the 7 DM checks + the 13 surface-mapped ones;
  render-dm-send-clears-4944's in-place arms now measure 50px pending = 50px kept); selectors 0.
- Surface gate run alone on 57572f0fd: rc 0, all 16 overridden by per-check trailers citing that run.
- web.dm-send-shows-now.test.js 4/4 (the tightened slot assertion fails on 45e52981d's page, passes now).
