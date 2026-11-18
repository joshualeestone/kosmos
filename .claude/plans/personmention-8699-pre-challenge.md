---
pre_challenge: true
method: challenge-loop
branch: personmention-8699
diff_hash: 44cb5556bf20a2c80cb0979f61f4f8bac6caed2b17b80e71189ae503bdc05a29
validation: passed
subdir_audit: passed
timestamp: 2026-11-18T17:05:54Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes
**Total findings:** 30 (0 BLOCKERs, 15 WARNINGs, 0 CONVENTIONs, 15 NITs)
**Fixed:** 11 | **Deferred:** 4 | **Asked (awaiting user):** 0

Note on order: the initial validation (6.0) was moved to after convergence, by standing practice on this fleet
(queue one full run after the review converges; a mid-loop fix wastes a run). Targeted suites ran every round:
the new file, messages.unmatched-8566, server.phonenotify-718, messages.mention-4642 (104/104 at the end), and
the messages/roomloop/server.post family once (449/449). Every new rule was perturbed and went red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/messages.js personNote: claimed the phone is told, true only on the token route --> FIXED (64f5feeb9f, note claims nothing about the phone)
- [WARNING] engine/messages.js personNamed: first-word fallback matched "Josh Smith" for Josh Stone --> FIXED (64f5feeb9f, first word only before a lower-case word)
- [WARNING] engine/messages.js: backtick skip diverges from mentionedMembers --> FIXED (64f5feeb9f, stated in the comment; mirrors outsidersNote)
- [NIT] postedMention vs postedRoom gating extended --> recorded in plan as known and kept
- [NIT] note omits cooldown --> resolved by the WARNING fix
- [NIT] one doc comment covered two functions --> FIXED (64f5feeb9f)
- [NIT] unmatchedNote skip set differed from personNamed --> FIXED (64f5feeb9f, one key set)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/messages.js: About-you read on every post --> FIXED (393f25def9, only with an @ or a header)
- [WARNING] engine/messages.js personKeysNow: word-level agent exclusion untested --> FIXED (393f25def9, comment + Dana Bot test)
- [NIT] personOff and quietRoom repeat conditions --> FIXED (393f25def9)
- [NIT] possessive strip redundant on the @ path; note word typed by poster; plan regression --> no change

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/messages.js: unmatchedNote and personNamed read a target by different rules (two contradicting notes) --> FIXED (5ec68ebab2, shared personInTarget + test)
- [WARNING] engine/messages.js: sender-less arrow header ignored --> FIXED (5ec68ebab2, reads headers as addressedMembers does)
- [WARNING] tests: federated, own post, reply untested --> FIXED (5ec68ebab2)
- [NIT] plan contradicted itself on the phone --> FIXED (5ec68ebab2)
- [NIT] header word shown as typed --> no change (printableName makes it safe)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/messages.js personNamed: roster parameter unused --> DEFERRED: it is used, in nameResolves(h.sender, poster, roster)
- [WARNING] engine/messages.js: reply that names the person gets no sender note --> FIXED (6245d9e9d3, plan: known and kept, as #8566)
- [NIT] doc comment for personNamed sat above isPersonWord --> FIXED (6245d9e9d3)
- [NIT] agent-word trade-off; read on hot path --> no change

#### Iteration 5
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html: postedMention label said only replies --> FIXED (a33fa65f58, web, iOS SettingsLogic.swift, docs/phone-notifications.md)
- [WARNING] tests: reply and federated arms of the note unpinned --> FIXED (a33fa65f58)
- [NIT] two header readers, subset relation unstated --> FIXED (a33fa65f58)
- [NIT] long comment line --> FIXED (a33fa65f58)
- [NIT] operator as a noun in a header --> FIXED (a33fa65f58, first-word try skips operator + test)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] common first name collides with an outsider --> DEFERRED: the documented trade-off (plan, weakest premise), bounded by the switch and cooldown
- [WARNING] header in a code fence still counts --> DEFERRED: matches addressedMembers for members
- [WARNING] no test that the note holds no double quote --> FIXED (942ec82820)
- [NIT] x3 --> no change

#### Iteration 7
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/messages.js personNote | BRANCH | Phone claim true on one route only | FIXED | 64f5feeb9f |
| 2 | 1 | WARNING | engine/messages.js personNamed | BRANCH | First-word fallback too loose | FIXED | 64f5feeb9f |
| 3 | 1 | WARNING | engine/messages.js personNamed | BRANCH | Backtick rule unstated | FIXED | 64f5feeb9f |
| 4 | 2 | WARNING | engine/messages.js sendPostWithDelivery | BRANCH | About-you read on every post | FIXED | 393f25def9 |
| 5 | 2 | WARNING | engine/messages.js personKeysNow | BRANCH | Agent word exclusion untested | FIXED | 393f25def9 |
| 6 | 3 | WARNING | engine/messages.js unmatchedNote | BRANCH | Two target rules | FIXED | 5ec68ebab2 |
| 7 | 3 | WARNING | engine/messages.js personNamed | BRANCH | Sender-less header ignored | FIXED | 5ec68ebab2 |
| 8 | 3 | WARNING | test file | BRANCH | Exclusions untested | FIXED | 5ec68ebab2 |
| 9 | 4 | WARNING | engine/messages.js personNamed | BRANCH | roster unused (false) | DEFERRED | used by nameResolves |
| 10 | 4 | WARNING | engine/messages.js | BRANCH | Reply note silent | FIXED | 6245d9e9d3 |
| 11 | 5 | WARNING | web/index.html:19782 | BRANCH | Switch label stale | FIXED | a33fa65f58 |
| 12 | 5 | WARNING | test file | BRANCH | Note arms unpinned | FIXED | a33fa65f58 |
| 13 | 6 | WARNING | engine/messages.js personKeysNow | BRANCH | Common-name collision | DEFERRED | documented trade-off |
| 14 | 6 | WARNING | engine/messages.js personNamed | BRANCH | Header in code fence | DEFERRED | matches addressedMembers |
| 15 | 6 | WARNING | test file | BRANCH | No-quote guard missing | FIXED | 942ec82820 |

### NITs (non-blocking, across all iterations)
- [NIT] postedMention vs postedRoom gating extended to named posts (1), recorded in plan
- [NIT] possessive strip redundant on the @ path (2)
- [NIT] header word shown as typed (3)
- [NIT] "Dana 2pm" style targets fall to the quiet side (6, 7)
- [NIT] three-word target "Dana Reyes Smith" accepted by the two-word try (7)
- [NIT] the @-or-header gate saves less than its comment suggests (7)
- [NIT] multi-word first names ("Mary Ann") reach only by @Mary, a lower-case continuation, or @operator (7)

### Strengths (across all iterations)
- Reuses the existing postedMention seam (switch, cooldown, project mute); namesPerson is a boolean only (1, 3)
- Every positive test has a control arm that can fail; perturbations of each rule went red (1, 7)
- One shared personInTarget rule removes a double-note defect (3, 5)
- The sender note claims nothing the board cannot see (4, 6)
