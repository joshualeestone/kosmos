---
pre_challenge: true
method: challenge-loop
branch: familycap-6309
diff_hash: 153ae41d777b583d7679afd327eb12aed00c81282a3fbc9aad1920d89ead9a68
validation: passed
subdir_audit: passed
timestamp: 2026-10-16T20:20:01Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18 (blind reviewers alternating opus and sonnet)
**Converged:** Yes. Iteration 18 raised no new BLOCKER, WARNING or CONVENTION: its two warnings restate the decided
limit that the cap does not hold against a person editing the data folder (deferred in iterations 2 and 14).
**Total findings (actionable):** 0 BLOCKERs, 50 WARNINGs, 6 CONVENTIONs; NITs recorded per iteration.
**Fixed:** 38 | **Deferred:** 18 (with reasons) | **Asked (awaiting user):** 0

**Validation:** the 6.0 run was queued at the start of the loop and cancelled at 12:28 (it would have validated a
tree that changed under it; recorded in my memory notes). The 6j run on the final commit (9a5dd24, rebased onto
main) passed: `validation PASSED for stack=typescript hash=153ae41d777b`, subdir audit clean, 15:19 CDT.

**Self-generated:** not classified by blame for every iteration. Findings on my own loop's lines that I acted on as
prose claims: iteration 3 (a comment claimed deleted transcripts kept the count; made true and tested), iteration 7
(a comment and the plan claimed the rollup tick ran in a child process; it does not), iteration 14 (transcriptread
claimed an unchanged move). Each was corrected with a check that fails if the claim is false, or removed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] swarm.js readFile: an earlier `since` zeroed the month --> FIXED (ae2d979)
- [WARNING] usagecap.js: a restart reopened the cap while catching up --> FIXED (ae2d979, saved floor)
- [WARNING] usagecap.js: bounded reads on every message --> FIXED (ae2d979; later the worker, 28e73ab)
- [WARNING] orgrollup.js: count sent under the policy-version words --> FIXED (ae2d979, NAMES_CAP)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] usagecap.js: fault reads open --> DEFERRED: decided with quiet hours; a person who can write the data folder can remove the policy itself
- [WARNING] usagecap.js: all Claude use counts --> FIXED (console hint, card)
- [WARNING] usagecap.js: floor reset on a zone change --> FIXED (743a403)
- [CONVENTION] plan Goal stale --> FIXED (743a403)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] usagecap.js: deleting a transcript lowered the count, against its own comment --> FIXED (fe102d4, high-water)
- [WARNING] usagecap.js: new board under-counts --> FIXED as a stated known limit (plan)
- [WARNING] orgrollup.js: unknown count blanked the parent's row --> FIXED (fe102d4)
- [WARNING] usagecap.js: directory walk on the message path --> FIXED later (28e73ab, worker; measured first)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] usagecap.js: a minute's memo let messages past the cap --> FIXED (e23099f)
- [WARNING] floor not tied to the company --> DEFERRED: it counts this computer's transcripts, which the month count reads whatever company
- [CONVENTION] chat.js capped not surfaced --> DEFERRED: the route returns the verdict with its `because`

#### Iteration 5
**Reviewer model:** opus
- [WARNING] usagecap.js: a later zone kept the earlier zone's hours --> FIXED (e0cff17)
- [WARNING] message-path reads --> FIXED (gate budget, e0cff17; superseded by the worker)
- [WARNING] month cache size --> DEFERRED: bounded by the month's own transcripts

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] usagecap.js: a running board zeroed the month on a later zone --> FIXED (e925aa7)
- [WARNING] message-path cost, raised a third time --> FIXED (28e73ab): measured 3.7 s a call on 2.5 GB, count moved to a worker thread
- [CONVENTION] orgrollup.js usageOk placement --> FIXED (e925aa7)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] orgrollup.js: the enrolled board's tick counted inline (my claim that it ran in a child was wrong) --> FIXED (2ee8d39, capReport)
- [WARNING] usagecap.js header claim --> FIXED (2ee8d39)
- [WARNING] unknown count dropped the policy fields and double-sent --> FIXED (2ee8d39, lastPolicy repeat)
- [WARNING] worker never stopped --> FIXED (2ee8d39)
- [WARNING] worker loads the engine --> FIXED later (1947a14, transcriptread.js)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] worker catch-up held a core --> FIXED (0e35ef1)
- [WARNING] worker message not validated --> FIXED (0e35ef1)
- [CONVENTION] merge order --> FIXED (plan, 0e35ef1)

#### Iteration 9
**Reviewer model:** opus
- [WARNING] swarm.js: the eviction sweep was quadratic on the month cache --> FIXED (35898d1)
- [WARNING] a new policy waited on the counter --> FIXED (35898d1, samePolicy)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] Start, Restart, put-back and create not capped, unlike quiet hours --> FIXED (aba1048)
- [CONVENTION] swarm earlier-since behaviour untested --> FIXED (aba1048)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] a message copied across files counted twice (measured 5.68%) --> FIXED (a096fe7, sharedSeen)
- [WARNING] old sessions' helper folders listed every recount --> FIXED (a096fe7)
- [WARNING] worker module graph --> DEFERRED then FIXED (measured 9 MB; 1947a14)

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] a rewritten file's ids lost to the shared set --> FIXED (6a46554)
- [WARNING] version without a count reads as no cap --> DEFERRED: checked, the card says "No usage reported yet"

#### Iteration 13
**Reviewer model:** opus
- [WARNING] worker failure silent --> FIXED (1947a14)
- [WARNING] orgpolicy.capAllows read 0 when called without a count --> FIXED (1947a14)
- [WARNING] any process started a worker --> FIXED (1947a14, countOnThisBoard)
- [CONVENTION] plan did not record the start gates --> FIXED (1947a14)

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] partial counts not saved --> FIXED (966ad3a)
- [WARNING] the data folder can be edited --> DEFERRED: decided on the card
- [CONVENTION] transcriptread claimed an unchanged move --> FIXED (966ad3a)

#### Iteration 15
**Reviewer model:** opus
- [WARNING] a config folder added mid-month never reached the worker --> FIXED (358b26e)
- [WARNING] worker test timing --> FIXED (358b26e)

#### Iteration 16
**Reviewer model:** sonnet
- [WARNING] only gate calls saved the count --> FIXED (50f38f4, handler saves)
- [WARNING] a crashed worker's count read as current --> FIXED (50f38f4)

#### Iteration 17
**Reviewer model:** opus
- [WARNING] counting waited for a first message --> FIXED (5277e1d, boot check)
- [WARNING] an assertion that could not fail --> FIXED (5277e1d)

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (2 warnings duplicate the deferred tamper limit), 3 NITs
- [NIT] usagecap-worker.js / transcriptread.js: a comment claimed no engine code loads --> FIXED (9a5dd24)
**Converged** -- no new actionable findings.

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, across all iterations)
- [NIT] orgpolicy.capAllows and usagecap.capAllows share a name (iterations 2, 7, 9, 11, 13, 15); the orgpolicy one now throws without a count
- [NIT] `capped` beside the Gemini `cap` vocabulary on one verdict (iterations 7, 15)
- [NIT] monthStart at a midnight daylight-saving change (iterations 9, 17)

### Strengths (across all iterations)
- The month count has its own cache; the swarm's day count is pinned unchanged (every iteration)
- The worker move rests on a measurement, not an estimate (iterations 7 to 18)
- Every gate site mirrors quiet hours, with tmux-argv assertions and under-the-cap controls (iterations 10 to 18)
