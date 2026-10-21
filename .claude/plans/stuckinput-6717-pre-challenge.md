---
pre_challenge: true
method: challenge-loop
branch: stuckinput-6717
diff_hash: a41168503362aefc4adf14e0fad160a6b195b26ee6d64aab888e293d7be4cbff
validation: pending-local (machine reserved for the 0.7.61 release cut; CI runs the full suite on the PR)
subdir_audit: pending-local
timestamp: 2026-10-20T14:27:45Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: no new finding after deduplication)
**Total findings:** 26 actionable (0 BLOCKERs, 23 WARNINGs, 3 CONVENTIONs), plus NITs
**Fixed:** 23 | **Deferred:** 3 (two WARNINGs judged not an issue, one CONVENTION) | **Asked (awaiting user):** 0

Validation: the full validation helper did NOT run locally. This machine was reserved for the 0.7.61 release cut
(tools/who-has-the-box.sh) for the whole loop, and heavy runs were held off by the PM's hold. Each iteration ran by hand,
one file at a time: engine/chat.stuckinput-6717.test.js (28/28 at the final head), server.stuckinput-6717.test.js (2/2),
web.stuckinput-6717.test.js (3/3), engine/chat.unsent-6436.test.js (20/20), fixture-discipline.test.js (20/20),
web.api-routes-3957.test.js (29/29), and once, after the first cut: engine.reachable, server.limitdm-5805,
web.agent-answers, web.avatarver-2762, web.links-everywhere, web.rename-4421, web.typing-order-1150,
web.speech-kind-1397, engine/signedout-5948, engine/chat.composer-6249, engine/status.unsent-6249,
web.unsent-input-6249, tools.browser-checks-wired, render-talk-goldencard-2519 (all pass). The PR's CI runs the full suite;
the local helper and the gated browser check render-unsent-draft-6717 run when the box frees, before merge.
Mutants run by hand: no recovery on the draft path (6 tests red), clearing before saving (3 red), the pressed-path
give-up removed (1 red).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/stuckinput.js: a box that will not clear is drafted again every minute and fills the store --> FIXED (cb0da94946: one draft per text, give up per since)
- [WARNING] engine/unsentdrafts.js: MAX_KEPT silently evicts unseen drafts --> FIXED (cb0da94946: refuse, never drop)
- [WARNING] server.js: no operator brake on a sweep that types keys --> FIXED (cb0da94946: AGENT_WORKFORCE_STUCK_INPUT_OFF=1)
- [CONVENTION] server.js: new route split the #5805 comment from its route --> FIXED (cb0da94946)
- [CONVENTION] engine/unsentdrafts.js: drafts keyed by session name orphan on rename --> DEFERRED (named in plan Residuals)
- [NIT] single empty read trusted --> FIXED; [NIT] buttons unstyled --> FIXED; [NIT] maxlength bypass --> FIXED (said under the box); [NIT] env name --> FIXED; [NIT] guide masking --> plan; [NIT] re-draft after typing --> plan

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/chat.js: words typed between the saving read and the first keys are cleared --> FIXED (2a0656caf4: read before every round; the last gap named in plan)
- [WARNING] engine/chat.js: substring "what is left" test passes a typed letter --> FIXED (2a0656caf4: stuckShrunk)
- [WARNING] engine/chat.js: Enter on our line that never takes is invisible --> FIXED (2a0656caf4: logged once)
- [CONVENTION] CLAUDE.md: where-to-find row missing --> FIXED (2a0656caf4)
- [CONVENTION] server.js: sweep wiring untested --> FIXED (2a0656caf4: wiring guard test)
- [NIT] gaveUp pruned on a busy minute --> FIXED; [NIT] log wording for an already-kept text --> FIXED; [NIT] whitespace residual; [NIT] dismiss message element

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (STUCK_ROWS_MAX at 150, written in the first cut)
- [WARNING] engine/chat.js: a scrolled box (7 rows) saves only its end, then fragments --> FIXED (eb922ed731: measured, boxes of 7 rows or more left whole)
- [WARNING] engine/chat.stuckinput-6717.test.js: fake pane never scrolls --> FIXED (eb922ed731: `keep` rows)
- [WARNING] engine/stuckinput.js: transient failures given up for good --> FIXED (eb922ed731: retry)
- [WARNING] engine/chat.js: person attached to the pane --> FIXED (eb922ed731: session_attached left alone)
- [NIT] told pruned --> FIXED; [NIT] raw-text dedupe --> FIXED; [NIT] DM_ROWS_OLDEST --> FIXED; [NIT] dismiss name case --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/chat.js: keys could land in a menu that opened mid-clear --> FIXED (2e82d5a6b3: the per-round read already stops it; comment says how)
- [WARNING] engine/chat.js: pressed path has no fresh idle check --> FIXED (2e82d5a6b3)
- [WARNING] engine/unsentdrafts.js: drafts folder default mode --> FIXED (2e82d5a6b3: 0700)
- [NIT] stuckShrunk precision; [NIT] memory-only maps; [NIT] no clamp

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the pressed-path 'left' from iteration 2's fix)
- [WARNING] engine/chat.js + stuckinput.js: our line whose Enter fails is pressed every minute, past #6436's day bound --> FIXED (cd98c486bc: giveUp)
- [WARNING] engine/unsentdrafts.js: a partial clear's leftover is drafted again --> FIXED (cd98c486bc)
- [NIT] draft placement in long threads --> plan; [NIT] dismiss name off-roster; [NIT] blank-row fixture --> FIXED; [NIT] comment placement --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs (one WARNING was a duplicate)
**Self-generated:** 1 of the above (the substring piece rule, written in iteration 5)
- [WARNING] engine/unsentdrafts.js: any substring counts as already kept, so "ok" folds into an old draft --> FIXED (fdd358ce28: a leftover shape, at least 20 characters)
- [NIT] attached check asymmetry --> comment; [NIT] single writer --> comment; [NIT] dismiss two reads

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/stuckinput.js: a store that refuses every save is never logged --> FIXED (210a5de1b5: outcome left, logged once)
- [WARNING] engine/chat.js: rounds that only empty blank rows count as a stall --> FIXED (210a5de1b5: rows dropping is progress)
- [NIT] body token on dismiss --> FIXED; [NIT] comment on wrong constant --> FIXED in iteration 8; [NIT] shadowed name --> FIXED; [NIT] wiring test is text-only; [NIT] dismiss double click

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs (three WARNINGs duplicated named residuals)
**Self-generated:** 1 of the above (the piece rule again)
- [WARNING] engine/unsentdrafts.js: the piece rule has no time bound --> FIXED (a7478a30c9: within the hour)
- [CONVENTION] engine/unsentdrafts.js: comment fused onto the wrong line --> FIXED (a7478a30c9)
- [CONVENTION] engine/chat.js: recoverStuckInput could move to stuckinput.js --> DEFERRED (it calls the #6436 internals it sits beside; moving them is churn without a defect)
- [NIT] waiting never logged (no saver: the server always sets one); [NIT] dismiss button state

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/chat.js: our line drafted with added words leaves the #6436 memory behind --> FIXED (147bf659ba: forgotten after the clear; the row's sentence named in plan)
- [WARNING] server.js: a draft as the trailing row defeats the undated question's dedupe --> FIXED (147bf659ba: drafts after the question row)
- [NIT] an old exact match is not seen today --> FIXED (moves to now); [NIT] splice residual --> plan; [NIT] the shrink test written twice --> FIXED (one helper)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 after deduplication
- [WARNING] drafts readable by an agent through the conversation route --> DEFERRED, not an issue: the same route already serves the person's own stored messages to the same callers; a draft is the person's words in that conversation, so it opens nothing new
- [WARNING] keys rebound by a later Claude Code --> duplicate of a named residual (iteration 1/7), and the draft is visible in the conversation
- [NIT] drafts left after an agent is removed --> duplicate (iteration 1); [NIT] "~10 min" rounding cannot read under ten (only cards at ten minutes or more are picked)

### Final Ledger

| # | Finding | Status |
|---|---|---|
| 1 | redrafted every minute when the box will not clear | FIXED |
| 2 | silent eviction at MAX_KEPT | FIXED |
| 3 | no operator brake | FIXED |
| 4 | route split a comment from its route | FIXED |
| 5 | drafts keyed by session name | DEFERRED (residual) |
| 6 | words typed before the first keys | FIXED (last gap named) |
| 7 | substring "what is left" | FIXED |
| 8 | failing Enter on our line invisible | FIXED |
| 9 | CLAUDE.md row | FIXED |
| 10 | wiring untested | FIXED |
| 11 | scrolled box fragments | FIXED |
| 12 | fake pane never scrolls | FIXED |
| 13 | transient failures given up | FIXED |
| 14 | attached terminal | FIXED |
| 15 | menu mid-clear | FIXED |
| 16 | pressed path idle | FIXED |
| 17 | drafts folder mode | FIXED |
| 18 | pressed every minute past the day bound | FIXED |
| 19 | leftover redrafted | FIXED |
| 20 | substring piece rule | FIXED |
| 21 | refused save never logged | FIXED |
| 22 | blank rows as a stall | FIXED |
| 23 | piece rule unbounded in time | FIXED |
| 24 | move recoverStuckInput | DEFERRED |
| 25 | drafted line left remembered | FIXED |
| 26 | question dedupe behind a draft | FIXED |
| 27 | agent can read drafts via the route | DEFERRED (not an issue) |

### Outstanding questions (ASKED, still unresolved when the run ended)

None.

### NITs (non-blocking, across all iterations)

Recorded per iteration above; the ones not fixed are named in the plan's Residuals or judged not an issue.

### Strengths (across all iterations)

- Save before clear, enforced in code and pinned by an ordering test; a refused or full store leaves the box alone.
- "Ours" is only the #6436 memory with an exact match; everything else is drafted and never sent.
- Drafts are derived rows, never stored messages, so unread, owes and reply nudges cannot misread them.
- Every clearing round is read before and after; any change it cannot explain stops it.
- Measured decisions (keys, the 7-row scroll, folded pastes) with rejected alternatives recorded.
