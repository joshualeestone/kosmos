---
pre_challenge: true
method: challenge-loop
branch: taskedit-8664
diff_hash: ac9902627c2a0e77f06b7a2dacf8eafc09f0d184f24681a3cb384cdbab6d6209
validation: passed
subdir_audit: passed
timestamp: 2026-11-18T03:57:50Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No: stopped after round 8 under Splinter's standing usage rule (stop at 8 rounds unless a BLOCKER is open; memory `feedback-usage-rule-8-rounds-one-reviewer`, Splinter 10-22 and 10-26). No BLOCKER was open at round 8; its one new WARNING was deferred (the card asks for it).
**Total findings:** 21 BLOCKER/WARNING/CONVENTION (0 BLOCKERs from reviewers, 17 WARNINGs, 4 CONVENTIONs), plus NITs
**Fixed:** 15 | **Deferred:** 6 | **Asked (awaiting user):** 0

Final validation (6j), after two failed runs whose causes were mine and fixed (synthetic findings 22 and 23): the full suite on f5c60c000c, 29,660 node tests 0 failed, all 4 shell shards green, the subdir CLAUDE.md audit clean; validation-log hash ac9902627c2a.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/tasks.js setText / server.js route — a new title never reached the assignees' instruction blocks --> FIXED (a7f77a8ed7): projects.syncAgent per assignee on a title change
- [WARNING] install/kosmos, tools/windows/kosmos-cli.js — an option taken as another's value (--title --clear-detail) --> FIXED (a7f77a8ed7): _opt_value / optValueRefused
- [WARNING] both CLIs — the unknown-option refusal offered a -- escape the verb does not take --> FIXED (a7f77a8ed7)
- [CONVENTION] CLAUDE.md:112 — the Tasks row named no edit route or verb --> FIXED (a7f77a8ed7)
- [NIT] taken: an edit that changes nothing says so (changed:false) instead of "Changed task N"

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/tasks.js:1708 — activity row order under concurrent edits --> DEFERRED: `before` is read inside the same locked write, as setDue and setDoneWhen do
- [WARNING] engine/tasks.js:1688 — a title with line breaks via the API is stored multi-line --> FIXED (a44fc7641b): one line, control characters to spaces

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the control-character title check, on round 2's fix line)
- [WARNING] engine/tasks.js:1103-1112 — a title of only control characters was stored empty --> FIXED (d3665d10de): clean first, then check
- [WARNING] engine/tasks.js / server.js — any agent could reword the task the person wrote --> FIXED (d3665d10de): refused with a 403, as done-when keeps the person's checks
- [WARNING] server.task-edit-8664.test.js — no test of editing a closed task --> FIXED (d3665d10de)
- [CONVENTION] engine/defaults.js:522 — the agents' instructions do not teach the verb --> DEFERRED: a doctrine bump racing #8668; follow-up #8680 (Angel)
- [CONVENTION] CLAUDE.md:110 — name the edited kind and its two phrasers --> FIXED (d3665d10de)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] the two CLIs clean a title differently --> DEFERRED after checking: both delete C0 other than tab/CR/LF and turn those into spaces; only a raw API caller differs, by a space
- [WARNING] an unnamed caller can edit and is not refused --> DEFERRED after checking: changeDoneWhen accepts an unnamed caller too, refusing only on the person's own checks

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (round 3's gate)
- [WARNING] engine/tasks.js:1704 — round 3's gate refused the person's own terminal, the only way this PR gives them to fix their task --> FIXED (f4ad83af5b): an identified agent only
- [WARNING] engine/tasks.js AGENT_ROW — an agent's rename dropped its own task out of #7151's retire offers --> FIXED (f4ad83af5b): `edited` on the allow-list, tested both ways
- [NIT] taken: the Windows not-a-number refusal tested; a doubled comment folded

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/tasks.js:1705 — an agent the board cannot name passes the person gate --> DEFERRED: the deliberate round-5 trade-off, in the plan
- [WARNING] ios/Kosmos/TaskPageLogic.swift — the iPhone shows the bare kind --> FIXED: follow-up #8679 filed (and since built, PR #8684)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs (1 duplicate), 1 CONVENTION, 5 NITs
**Self-generated:** 1 of the above
**Duplicates of prior findings:** 1 (the unnamed bypass, iteration 6)
- [WARNING] engine/tasks.js:1717 — an edit from the person's terminal did not mark the words as the person's --> FIXED (faf781d98b)
- [WARNING] install/kosmos:7295 — an empty or control-only --detail cleared the detail silently --> FIXED (faf781d98b): refused on both CLIs, LC_ALL=C on the sed stages
- [CONVENTION] engine/tasks.js:1669 — follow-ups not named by card --> FIXED (faf781d98b): #8679, #8680 in the plan
- [NIT] taken: "changed":false read anywhere in the answer

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/tasks.js:1728 — the edited row keeps the old and new detail text --> DEFERRED: the card asks for it ("recorded in the task's activity (old text, new text, who, when)"); FIELD_MAX 4000 exceeds DETAIL_MAX 2000, so nothing is cut
Stopped here under the usage rule (no BLOCKER open).

#### Final validation (6j) findings
- [BLOCKER] final-validation: engine/windows-tests-1777 (cli.task-edit-8664.test.js branches on win32, unlisted) and web.open-sentence-1199 (a ninth inline capitaliser) --> FIXED (693435097a)
- [BLOCKER] final-validation: tools/test-msg-newlines-1927.sh (a tenth multi-line escape site) --> FIXED (f5c60c000c), with the note each earlier site added

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/tasks.js setText | BRANCH | New title not told to assignees | FIXED | a7f77a8ed7 |
| 2 | 1 | WARNING | both CLIs | BRANCH | Option taken as a value | FIXED | a7f77a8ed7 |
| 3 | 1 | WARNING | both CLIs | BRANCH | Bad -- hint | FIXED | a7f77a8ed7 |
| 4 | 1 | CONVENTION | CLAUDE.md:112 | BRANCH | Tasks row missing the verb | FIXED | a7f77a8ed7 |
| 5 | 2 | WARNING | engine/tasks.js:1708 | BRANCH | Row order under concurrency | DEFERRED | as setDue/setDoneWhen |
| 6 | 2 | WARNING | engine/tasks.js:1688 | BRANCH | Multi-line title via API | FIXED | a44fc7641b |
| 7 | 3 | WARNING | engine/tasks.js:1103 | SELF | Control-only title stored empty | FIXED | d3665d10de |
| 8 | 3 | WARNING | engine/tasks.js | BRANCH | Agent rewords the person's task | FIXED | d3665d10de |
| 9 | 3 | WARNING | server test | BRANCH | Closed-task edit untested | FIXED | d3665d10de |
| 10 | 3 | CONVENTION | engine/defaults.js:522 | BRANCH | Verb not taught | DEFERRED | #8680 |
| 11 | 3 | CONVENTION | CLAUDE.md:110 | BRANCH | Phrasers not named | FIXED | d3665d10de |
| 12 | 4 | WARNING | both CLIs | BRANCH | Title cleaning parity | DEFERRED | checked: same |
| 13 | 4 | WARNING | engine/tasks.js | BRANCH | Unnamed caller edits | DEFERRED | as done-when |
| 14 | 5 | WARNING | engine/tasks.js:1704 | SELF | Gate refused the person's terminal | FIXED | f4ad83af5b |
| 15 | 5 | WARNING | engine/tasks.js AGENT_ROW | BRANCH | Rename dropped retire offers | FIXED | f4ad83af5b |
| 16 | 6 | WARNING | engine/tasks.js:1705 | SELF | Unnamed agent passes the gate | DEFERRED | round-5 trade-off |
| 17 | 6 | WARNING | ios TaskPageLogic.swift | BRANCH | iPhone bare kind | FIXED | #8679 |
| 18 | 7 | WARNING | engine/tasks.js:1717 | SELF | Terminal edit not marked | FIXED | faf781d98b |
| 19 | 7 | WARNING | install/kosmos:7295 | BRANCH | Empty --detail clears silently | FIXED | faf781d98b |
| 20 | 7 | CONVENTION | plan | BRANCH | Follow-ups unnamed | FIXED | faf781d98b |
| 21 | 8 | WARNING | engine/tasks.js:1728 | BRANCH | Detail text kept in the row | DEFERRED | the card asks for it |
| 22 | 6j | BLOCKER | final-validation | BRANCH | Windows list, ninth capitaliser | FIXED | 693435097a |
| 23 | 6j | BLOCKER | final-validation | BRANCH | Tenth escape site | FIXED | f5c60c000c |

### NITs (non-blocking, across all iterations)
- projects.mutate writes even when nothing changed (as setDue) (1, 3)
- webhook tasks keep their webhook quoting after an edit (1, 7)
- no runaway valve on edits (as done-when) (3, 5)
- the page phrase leaves titles unquoted (as the done-when siblings) (7)
- a title starting with -- cannot be given (no -- escape, by design) (7)
- create and setText normalise titles differently for API callers (5)

### Strengths (across all iterations)
- The route reuses done-when's caller rules and joins AGENT_TOKEN_ROUTE_PATTERNS with its pinned test updated.
- The person gate is checked inside projects.mutate, so it cannot race a screen edit.
- Both CLIs are held to the same bodies and pre-request refusals by one table-driven test with a control that reaches the stub.
- Every new guard was mutation-checked red: the sync, the person gate (both arms), the allow-list row, the empty --detail on each CLI, the option-as-value refusal.
