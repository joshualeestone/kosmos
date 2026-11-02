---
pre_challenge: true
method: challenge-loop
branch: stallack-7794
diff_hash: 8e4f85178176c5f0d7831f773ce424379191f7a8e853ed9caa33b2e675ff07eb
validation: passed
subdir_audit: passed
timestamp: 2026-11-02T21:20:47Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the fleet's 8-round review cap (Splinter's 10-22 usage rule: past 8 only with a BLOCKER open). Round 8 raised no BLOCKER; its one new WARNING (a late ack is not told apart in the log) and two NITs went to follow-up card kosmos#7802.
**Total findings:** 15 actionable (0 BLOCKERs, 15 WARNINGs, 0 CONVENTIONs), plus NITs
**Fixed:** 11 | **Deferred:** 4 (documented residuals, each failing toward the email) | **Asked:** 0

Validation: full `yarn test` + build via validation_log_run_or_skip on bd13571fe (hash 8e4f85178176): 26436 node tests, 0 failed; shell suite 4 shards all green. Subdir CLAUDE.md audit clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/deliverystreak.js acksDue - ack at recovery can cancel the only warning for an agent that stalls again before 30 min --> FIXED (3eb850132: ack no sooner than 25 min, conditions read then)
- [WARNING] engine/phonenotify.js acked - ignores the #6488 Kosmos+ switch --> FIXED (3eb850132)
- [WARNING] engine/deliverystreak.js untold - drops a push the coordinator may have stored --> FIXED (3eb850132: kept open)
- [WARNING] engine/stallack-7794.test.js restart arm could not fail --> FIXED (3eb850132)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] 25 to 30 minute window --> DEFERRED: residual in the plan, narrow, needs a new stall to form
- [WARNING] reset/settleFor/sweep recoveries never ack --> DEFERRED: fails toward the email; named as the plan's weakest premise
- [WARNING] an ack is one attempt --> DEFERRED: fails toward the email; residual in the plan
- [NIT] test comment claim unchecked --> FIXED (c860597c9, deleted)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (the plan's retry sentence, written by iteration 1's fix)
- [WARNING] a retry under the same id overwrote the open entry --> FIXED (a518883a8: join)
- [NIT] plan said a late ack answers matched:false --> FIXED (a518883a8)
- [NIT] two comments claimed more than the code --> FIXED (a518883a8, claims deleted)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] a throwing sender left an entry open --> FIXED (f770d6b7a)
- [WARNING] ack correctness rested on the sweep order --> FIXED (f770d6b7a: an end clears only pushes made at or before it)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] retry kept the first push's clock though the coordinator may hold only the retry --> FIXED (b21607ec6: clock restarts at the retry; join tested)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2 of the above
- [WARNING] a retry did not reopen an agent an earlier end cleared --> FIXED (97c55fff3)
- [WARNING] an untaken retry mutated the open entry --> FIXED (97c55fff3: join only once taken)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] any streak holds the ack, even a stray failed delivery --> DEFERRED: fails toward the email; residual in the plan (bd13571fe)
- [NIT] same-sweep push never cleared --> residual in the plan (bd13571fe)
- [NIT] future-time guard untested --> FIXED (bd13571fe, mutated red)
- [NIT] test header wording --> FIXED (bd13571fe)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (plus one duplicate of a documented residual), 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] a late ack is logged like an on-time one --> follow-up kosmos#7802 (cap reached, no BLOCKER)
- [WARNING] retry clock restart: first push stored acks late --> duplicate of the plan's residual (DEFERRED)
- [NIT] failed ack logged in the push's words; doc comment width --> follow-up kosmos#7802

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/deliverystreak.js acksDue | BRANCH | early ack loses warning | FIXED | 3eb850132 |
| 2 | 1 | WARNING | engine/phonenotify.js acked | BRANCH | Kosmos+ switch ignored | FIXED | 3eb850132 |
| 3 | 1 | WARNING | engine/deliverystreak.js untold | BRANCH | failed push dropped | FIXED | 3eb850132 |
| 4 | 1 | WARNING | engine/stallack-7794.test.js | BRANCH | restart arm vacuous | FIXED | 3eb850132 |
| 5 | 2 | WARNING | engine/deliverystreak.js | BRANCH | 25-30 min window | DEFERRED | residual, narrow |
| 6 | 2 | WARNING | engine/deliverystreak.js | BRANCH | no-end recoveries never ack | DEFERRED | toward the email |
| 7 | 2 | WARNING | engine/phonenotify.js | BRANCH | one ack attempt | DEFERRED | toward the email |
| 8 | 3 | WARNING | engine/deliverystreak.js tellStalls | SELF | retry overwrote entry | FIXED | a518883a8 |
| 9 | 4 | WARNING | engine/deliverystreak.js tellStalls | SELF | throwing sender | FIXED | f770d6b7a |
| 10 | 4 | WARNING | engine/deliverystreak.js acksDue | BRANCH | sweep-order dependence | FIXED | f770d6b7a |
| 11 | 5 | WARNING | engine/deliverystreak.js tellStalls | SELF | retry clock | FIXED | b21607ec6 |
| 12 | 6 | WARNING | engine/deliverystreak.js tellStalls | SELF | retry reopen | FIXED | 97c55fff3 |
| 13 | 6 | WARNING | engine/deliverystreak.js tellStalls | SELF | untaken retry mutates | FIXED | 97c55fff3 |
| 14 | 7 | WARNING | engine/deliverystreak.js acksDue | BRANCH | any streak over-holds | DEFERRED | toward the email |
| 15 | 8 | WARNING | engine/phonenotify.js acked | BRANCH | late ack not logged apart | DEFERRED | kosmos#7802 |

### NITs (non-blocking)
- server.js wiring test reads source text, not behaviour (iterations 1, 3, 4, 6, 7)
- failed ack logged in the push's words; doc comment width (iteration 8, kosmos#7802)

### Strengths
- Ack body and id match the coordinator's notify-ack contract byte for byte (120-byte cut, camelCase, notify token)
- installid-senders-5995 kept at exactly one install-field line through addressed(); payload() output unchanged
- Every uncertain path fails toward the email; each rule has a test that went red when the rule was mutated (19 mutants)
