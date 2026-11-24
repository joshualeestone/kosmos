---
pre_challenge: true
method: challenge-loop
branch: permno-8952
diff_hash: d5321b96cccaa4b762c76158c8f10c7507b1ea0edd50306b28ebb88fbfa7cf41
validation: passed (Mortals after rebase onto fd53853c0f, 30,289 node tests 0 failed, entry 2026-11-24T11:29:07Z)
subdir_audit: passed
timestamp: 2026-11-24T11:29:18Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the cap Mona Lisa runs under, one reviewer at a time)
**Converged:** Yes. Round 7 returned NITs only; NIT fixes were reviewed again in round 8, whose two WARNINGs were deferred with reasons after reading the code.
**Total findings:** 17 actionable (0 BLOCKERs, 13 WARNINGs, 2 CONVENTIONs, 2 NIT-level fixes counted), plus NITs below
**Fixed:** 13 | **Deferred:** 6 | **Asked (awaiting user):** 0

Validation between rounds was targeted (server.permdeny-8952.test.js, server.permscroll-8952.test.js, the question-menu, permission-request and phone-notice suites, all iOS LogicTests suites, simulator build); one full validation at convergence on Mortals.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [NIT] server.permdeny-8952.test.js — unused notice/reportId helpers --> FIXED (ffa10a9e)
- [NIT] server.permdeny-8952.test.js — Yes/lasting cases did not prove which gate refused --> FIXED (ffa10a9e, refusal sentence asserted)
- [NIT] server.permdeny-8952.test.js — engine identity and request refusals untested on their own --> FIXED (ffa10a9e, engine-level test, mutation-checked)
- [NIT] engine/chat.js — deny-only refusal said "question changed" --> FIXED (ffa10a9e)
- [NIT] server.js — comment claimed dmPressable's two-reader check --> FIXED (ffa10a9e)
- [NIT] ios/Kosmos/ChatChoices.swift — show the visible tail --> DEFERRED: no terminal text on the phone (design)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js — denyOnly flag dropped at a non-permission menu --> FIXED (a65752e1, route 409 + test with a "No" option menu, mutation-checked)
- [WARNING] engine/chat.js — comments overclaimed "box top scrolled away" --> FIXED (a65752e1)
- [NIT] engine/chat.js — whole box also accepted --> FIXED (comment, a65752e1)
- [NIT] ios/Kosmos/ChatView.swift — allow -1 implicit --> FIXED (comment, a65752e1)
- [NIT] server.js — no test for null denyAsked / two Nos --> DEFERRED: claudePermissionPrompt already refuses two Nos

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/Kosmos/ChatView.swift — refused Deny's line cleared on next read --> FIXED (66e02ecd, Board.liveChoices, tested)
- [WARNING] ios/Kosmos/ChatView.swift — dropChoices left a stale Deny live --> FIXED (66e02ecd, Board.withoutChoices, tested)
- [NIT] engine/status.js — plan-mode prompts --> later found unreachable (iteration 5)
- [NIT] server.permdeny-8952.test.js — GET gates untested --> FIXED in iteration 7 (guide thread)
- [NIT] engine/chat.js — engine gate looser than route --> FIXED (comment, 66e02ecd)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js / BoardLogic.swift — denyOnly on every unreported question row --> FIXED (d53d6e1b, live row only, both ends, tested)
- [WARNING] BoardLogic.swift — repeated visible tail inside the answered lock --> DEFERRED: same key shape as existing buttons, nothing sent, recorded in plan

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/Kosmos/BoardClient.swift — keptThread kept a row's Deny --> FIXED (dd363cd6, mutation-checked)
- [WARNING] ios/Kosmos/ChatView.swift — card hides visible request text --> DEFERRED: no terminal text by design; the row showed none before
- [NIT] .claude/plans — plan-mode claim unreachable --> FIXED (dd363cd6, plan corrected)
- [NIT] BoardLogic.swift — askedWay comment --> FIXED (dd363cd6)
- [NIT] server.js — "never an older row" overclaim --> FIXED (dd363cd6)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] BoardLogic.swift — liveChoices relies on live-row-only Deny --> FIXED (comment, c2a1ee80)
- [WARNING] server.js — whole box with reader mismatch gets neither --> DEFERRED: safe direction, unchanged from main
- [WARNING] engine/chat.js — /^No\b/ any No --> DEFERRED: claudePermissionPrompt requires exactly one No
- [CONVENTION] BoardLogic.swift — long comment line --> FIXED (c2a1ee80)
- [NIT] server.permdeny-8952.test.js — plain-No control did not prove its gate --> FIXED (c2a1ee80)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [NIT] server.permdeny-8952.test.js — setup guide exclusion untested --> FIXED (14b482d6, with control, mutation-checked)
- [NIT] BoardLogic.swift askedWay comment, BoardClient.swift keptThread comment, engine/chat.js guard comment, plan counts --> FIXED (14b482d6)

#### Iteration 8
**Reviewer model:** sonnet (whole branch, nothing marked settled)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js — deduped live row --> DEFERRED: withQuestionRow dedupes only against a trailing stored row with the same question, so that row is the live question
- [WARNING] engine/chat.js — engine One-No check --> DEFERRED: menu.permission already guarantees exactly one /^No\b/ option
- [NIT] ChatView.swift VoiceOver grouping; BoardLogic.swift same-tail key --> noted
**Converged.**

#### Iteration 9 (after rebase onto main fd53853c0f, which carried #8957)
**Reviewer model:** opus (whole branch, nothing marked settled)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- Conflicts in ios/Kosmos/BoardLogic.swift and ios/LogicTests/main.swift were both additive (#8957's board words and tests beside this slice's); both kept, no line of main's removed. LogicTests 2243/2243, every run-*.sh green, app builds.
- [NIT] engine/chat.js comment wording "can only refuse"; [NIT] where Yes is given on the computer; [NIT] sample switch for the Deny card's states; [NIT] base drift --> noted
**Converged.**

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | WARNING | server.js | BRANCH | denyOnly dropped at a non-permission menu | FIXED | a65752e1 |
| 2 | 2 | WARNING | engine/chat.js | BRANCH | comments overclaimed scope | FIXED | a65752e1 |
| 3 | 3 | WARNING | ios/Kosmos/ChatView.swift | BRANCH | refusal line cleared | FIXED | 66e02ecd |
| 4 | 3 | WARNING | ios/Kosmos/ChatView.swift | BRANCH | stale Deny after failed read | FIXED | 66e02ecd |
| 5 | 4 | WARNING | server.js | BRANCH | Deny on every question row | FIXED | d53d6e1b |
| 6 | 4 | WARNING | ios/Kosmos/BoardLogic.swift | BRANCH | repeated tail in answered lock | DEFERRED | same as existing buttons |
| 7 | 5 | WARNING | ios/Kosmos/BoardClient.swift | BRANCH | kept copy keeps Deny | FIXED | dd363cd6 |
| 8 | 5 | WARNING | ios/Kosmos/ChatView.swift | BRANCH | hides visible text | DEFERRED | design: no terminal text |
| 9 | 6 | WARNING | ios/Kosmos/BoardLogic.swift | BRANCH | liveChoices assumption | FIXED | c2a1ee80 |
| 10 | 6 | WARNING | server.js | BRANCH | reader mismatch whole box | DEFERRED | safe, unchanged |
| 11 | 6 | WARNING | engine/chat.js | BRANCH | any No label | DEFERRED | one No guaranteed |
| 12 | 6 | CONVENTION | ios/Kosmos/BoardLogic.swift | BRANCH | long line | FIXED | c2a1ee80 |
| 13 | 8 | WARNING | server.js | BRANCH | deduped live row | DEFERRED | same question |
| 14 | 8 | WARNING | engine/chat.js | BRANCH | engine one-No | DEFERRED | guaranteed by reader |

### NITs (non-blocking, across all iterations)
- [NIT] ios/Kosmos/ChatChoices.swift — group the card's two lines for VoiceOver (iteration 8)
- [NIT] ios/Kosmos/BoardLogic.swift — same-tail key stale line untested (iteration 8)

### Strengths (across all iterations)
- The deny gate sits at the last look before the key, and the route refuses a deny-only press at any other menu (every round)
- Real-route tests with controls that can fail, refusal sentences asserted, each new gate mutation-checked (iterations 1 to 8)
- Phone side fails closed: kept copies, failed reads and older rows never carry a Deny (iterations 5 to 8)
