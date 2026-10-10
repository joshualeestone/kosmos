---
pre_challenge: true
method: challenge-loop
branch: menubuttons-5406
diff_hash: 75f0f0afa20873cf42dadc391f782aabc01b850a38ce49715cb99f1293c1d5d0
validation: passed (rebased on origin/main f22f0de85, which carries #5760 (#5754 + #5743, the delivery menu hold); test files chosen by CONTENT (every *.test.js naming chose:, asked:, deliverAsync, deliverAutomatic, deliverWithGap, answerQuestionMenu, closeQuestionMenu, menuHeld, dmChoice, question-menu or menuhold: 48 files) plus the fixture-discipline, brand, name, engine.reachable, browser-check wiring and Windows guards, run from the repo root: 2442 tests, 0 fail, 21 skipped (Windows-only probes); each new guard red by mutation; the browser check render-dmchoices-5406 runs in this PR's CI browser-checks job)
subdir_audit: passed
timestamp: 2026-10-10T06:59:14Z
iterations: 34
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 34 (iteration 1 is the 6.0 validation pass; 33 blind reviewer passes; iteration N is review round N-1)
**Converged:** Yes
**Total findings (iterations 1 to 13):** 33 actionable (1 BLOCKER, 27 WARNINGs, 5 CONVENTIONs) plus NITs
**Fixed:** 29 | **Deferred:** 4 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 validation)
**Reviewer model:** none (validation helper and focused guards)
**New findings:** 1 BLOCKER, 1 CONVENTION
**Self-generated:** 0 (synthetic, BRANCH by instruction)
- [BLOCKER] initial-validation: fixture-discipline failed (web.dmchoices-5406.test.js hand-built a card) --> FIXED (a45febd07, now from the fleet fixture)
- [CONVENTION] .claude/plans/ no plan file for the branch --> FIXED (plan written)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0
- [WARNING] web/index.html paintTalk: choices set before the staleness checks --> FIXED
- [WARNING] server.js: asked served unmasked in the setup guide's thread --> FIXED (null there; tested with a control)
- [WARNING] web/index.html dmChoicePress: a refusal left stale buttons up --> FIXED (repaints)
- [CONVENTION] web/index.html threadKey: a DM_CHOICES.sig term that changed nothing --> FIXED (removed, plan corrected)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 0
- [WARNING] a mid-flight repaint re-enabled the buttons (double press) --> FIXED (in-flight state drawn disabled)
- [WARNING] a rewrite lost keyboard focus on a choice --> FIXED (focus put back by digit; browser-check arm)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 3 NITs
**Self-generated:** 1
- [WARNING] any 200 read as "Sent." (delivery.state ignored) --> FIXED
- [WARNING] an outcome note outlived its question --> FIXED
- [WARNING] focus lost on every press --> FIXED
- [WARNING] buttons for the folder-trust dialog --> DEFERRED: measured, the observed dialog yields no options; a server test pins that no buttons are drawn

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** 1
- [WARNING] an answered question re-offered its buttons --> FIXED (short lock)
- [WARNING] buttons for runners other than Claude --> FIXED (asked for Claude cards only; tested)
- [WARNING] a failed read left dead buttons --> DEFERRED: the failure branch rewrites the whole thread with its sentence, so the buttons go

#### Iteration 6
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** 2
- [WARNING] a refusal's reason lost when the question changed --> FIXED (said on the conversation's line)
- [WARNING] a stale press typed as a prompt when no question is up --> FIXED (409; tested with a typed-digit control)
- [WARNING] focus moved into another agent's conversation --> FIXED

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 1
- [WARNING] a press whose words failed their bounds skipped every check --> FIXED (askedGiven)
- [WARNING] the answered lock stuck on a repeated question --> FIXED (expires after the stale-poll window)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 3 NITs
**Self-generated:** 0
- [BLOCKER] buttons drawn for Claude's permission prompts, where a press is pasted and Enter takes the highlighted option --> FIXED (asked only for status.claudeQuestionMenu; the server refuses any other screen; tested)
- [WARNING] a refusal stayed under the composer after a success --> FIXED
- [WARNING] plan silent on permission prompts --> FIXED

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 3 NITs
**Self-generated:** 0
- [WARNING] a press for a non-Claude agent was not refused at the server --> FIXED (tested)

#### Iteration 10
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 5 NITs
**Self-generated:** 2
- [WARNING] a failed request or unreadable 200 read as "did not go" --> FIXED ("could not confirm")
- [WARNING] the answered lock dropped by another agent's paint --> FIXED (per agent)

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 1
- [WARNING] an unconfirmed outcome re-offered the buttons at once --> FIXED (same short lock, no "Sent.")

#### Iteration 12
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] buttons where the composer is closed --> FIXED (presence rule)
- [WARNING] a press and a typed send could overlap --> FIXED (each waits for the other; tested)
- [WARNING] an automatic message could carry a question identity --> FIXED (refused as not plain text; tested)

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs after dedup, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] options numbered 10 or more get dead buttons --> DEFERRED: status.claudeQuestionMenu returns null above 9 entries and the GET serves asked only when it matches
**Converged:** no new actionable findings.

### Final Ledger (actionable)

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | BLOCKER | web.dmchoices-5406.test.js | BRANCH | hand-built card | FIXED |
| 2 | 1 | CONVENTION | .claude/plans | BRANCH | no plan file | FIXED |
| 3 | 8 | BLOCKER | server.js GET | BRANCH | permission-prompt buttons | FIXED |
| 4 | 4 | WARNING | server.js | BRANCH | trust dialog | DEFERRED (measured) |
| 5 | 5 | WARNING | web/index.html | BRANCH | failed read | DEFERRED (thread rewritten) |
| 6 | 13 | WARNING | web/index.html | BRANCH | 10+ options | DEFERRED (capped at 9) |
| ... | 2-12 | WARNING/CONVENTION | server.js, web/index.html, plan | BRANCH/SELF | as listed per iteration | FIXED |


#### Iterations 14 to 34 (review rounds 13 to 33)
Reviewer models alternate: sonnet on odd rounds, opus on even. Every WARNING or CONVENTION a round raised was fixed in that round's commit (subject quoted). Round 33 (iteration 34, sonnet) found nothing above NIT: converged; two NITs taken.
- Iteration 14 (round 13, sonnet): no commit in this round
- Iteration 15 (round 14, opus): an identity that is not text is refused; the positive control asserts the key went out; a 5xx reads as could-not-confirm; a typed send does not say Sending under the choices; plan names #5754 as the floor for words-only typing
- Iteration 16 (round 15, sonnet): a comment and two older test titles claimed more than they check; plan states the 6 s lock's limit
- Iteration 17 (round 16, opus): words that failed their check get their own refusal, not "the question changed"; null asked treated alike; comment and plan precision
- Iteration 18 (round 17, sonnet): no buttons for a label a press could never carry; that refusal points at the window; a number missing from the live menu gets its own sentence; the key goes only with words both menu readers agree on
- Iteration 19 (round 18, opus): one key answer per agent at a time at the server, so two windows cannot both answer; press-kind refusals first so their sentence is true; the still-sending-your-choice line is cleared when the press ends
- Iteration 20 (round 19, sonnet): the identity check tested on the live menu; false order comments deleted and the older assertions re-aimed; an unreachable second refusal removed; a typed delivery waits while a key answer settles
- Iteration 21 (round 20, opus): focus to the message box after a could-not-confirm press too; the send-during-a-press guard is a tested function the composer calls; plan and a test title say refused, not waits
- Iteration 22 (round 21, sonnet): a named pressable check that also needs both menu readers to agree; the cursor clamp tested on the live single-select menu; may-have-sent is a flag, not a copy match
- Iteration 23 (round 22, opus): equality vs containment pinned on the live menu; the two older Yes/No tests say which refusal they get and drop a comment that is no longer true
- Iteration 24 (round 23, sonnet): two older test titles say what they cover and where the rest moved; a refusal sentence true for a non-digit press too
- Iteration 25 (round 24, opus): at a non-menu screen a moved question is told it moved, and only the same question is told it cannot be answered by button; a typed message meeting a settling key gets a typed message's sentence; older tests pin which refusal they get again
- Iteration 26 (round 25, sonnet): the busy-slot sentence says handled, true for a close as for an answer; two older test titles say what they now check and where the live-menu identity check lives
- Iteration 27 (round 26, opus): the busy refusal says nothing was sent; the typed-message mapping tested through the route; a stale older-test comment rewritten; no "press again" where no button exists
- Iteration 28 (round 27, sonnet): an older test comment no longer calls itself the control; says where the control lives
- Iteration 29 (round 28, opus): focus never lands on a different question's button after a redraw or a refusal; the unread refusal says look again, not press; tests for the unread arm and which words refusal fires
- Iteration 30 (round 29, sonnet): a question repeated word for word with other choices gets a new button generation, so focus never carries onto choices not read; plan notes the words-only refusal sentence
- Iteration 31 (round 30, opus): the refusal focus path compares the button generation, so new choices under the same words never get focus; a browser-check arm for the rewrite-to-a-different-question branch
- Iteration 32 (round 31, sonnet): a redraw during the lock sends focus to the message box, not to a disabled choice
- Iteration 33 (round 32, opus): a changed header is a new question, a disabled choice never takes focus after a refusal, a failed screen read says so, Sent. announced once
- Iteration 34 (round 33, sonnet): the question line is found by equality before a header holding its words; the announce comment no longer overclaims

### NITs (non-blocking, across all iterations)
- Several wording, comment and accessibility notes; the ones taken are in the commits (digit kept in the accessible name, null-body guard, DM_CHOICE_UNSURE rename, success announced in the persistent live region).

### Strengths (across all iterations)
- The server, not the page, supplies the question's identity, from the same function the POST checks against.
- Every path where a press could be pasted rather than sent as a key is refused at the server, each with a test asserting nothing typed.
