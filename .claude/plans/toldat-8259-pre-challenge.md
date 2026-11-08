---
pre_challenge: true
method: challenge-loop
branch: toldat-8259
diff_hash: 1e5e07b9cd58a3f3b2607e5f0f42302b8a8e1856cea8d609b6d61eae3e00f0a4
validation: passed
subdir_audit: passed
timestamp: 2026-11-08T21:22:14Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 22 (0 BLOCKERs, 8 WARNINGs, 1 CONVENTION, 13 NITs)
**Fixed:** 17 | **Deferred:** 5 | **Asked (awaiting user):** 0

Stated deviations from the skill, so a reader does not take this for a verbatim run:
- The blind reviewers were given a hand-written prompt, not the 6a template text. It asked for the whole review (behaviour,
  marks, prompts, throws, regressions, pane safety, comments, tests) and set the same read-only rules; it was broader, not
  narrower. It did not include the template's plan-file check, so the missing plan file was not raised by a reviewer; it is
  recorded below as found by me and fixed.
- The loop's fixes were made in a second worktree (toldat-8259-r1) because the first worktree was under a running full
  suite; they were fast-forwarded onto toldat-8259 and rebased onto origin/main before the final gates.
- 6j's validation was run as the full suite (tools/run-tests.sh through the heavy queue) plus the page check
  render-onhold-4771, on exactly 30d7a384aa: both exit 0, node tally 27703 pass / 0 fail. Not the validation-log helper,
  which runs a subset of CI here.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/holdtold.js noteTold/noteAnswered: a follow-up ask is never recorded, so the second answer gets no prompt --> FIXED (onHoldLastToldAt, answeredOpen)
- [WARNING] server.js DM held trailers, task route keepTaskLine: the clause rides lines kept for later and may be stale --> FIXED (never on kept lines)
- [WARNING] web/index.html tskHoldToldWords: a slow clock reads a recorded ask as "not seen" --> FIXED (branch on presence)
- [WARNING] server.js DM route, engine/messages.js: marks answered when the line was not typed --> FIXED (placed only; room: reached holders)
- [NIT] web/index.html: helper split agoWords from its doc comment --> FIXED
- [NIT] engine/tasks.js: HOLD_TOLD_FIELDS split isOnHold from its doc comment --> FIXED
- [NIT] engine/holdtold.js namedNumbers: a bare #N in a DM is usually a card number --> FIXED (DM needs "task N")
- [NIT] engine/tasks.js setOnHold: a changed reason kept the marks --> FIXED (a new reason drops them)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the two-holder room mark came from iteration 1's reached filter)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] engine/messages.js room mark: with two holders, one reached marks it answered --> FIXED (every holder)
- [WARNING] engine/holdtold.js clauseFor: unbounded clause length after the length checks --> FIXED (three named, rest counted)
- [NIT] engine/holdtold.js header: says marked "once typed", task route marks regardless --> FIXED (header says per route)
- [NIT] engine/holdtold.js noteTold: a drained reply's old time can move marks back --> FIXED (floor at the latest tell)
- [NIT] engine/holdtold.js namedNumbers in rooms: bare #N can be a card --> DEFERRED: #N is the room's own way to name a task, and the project is known there
- [NIT] engine/holdtold.js markAnswered: lift and re-hold during one delivery --> DEFERRED: the new hold drops its marks first; at worst one "answered" reading

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the once-per-tell rule came from iteration 1's fix)
- [WARNING] engine/holdtold.js noteAnswered: an answer naming the task is dropped after an earlier answer --> FIXED (named always counts; clause says to name the task)
- [NIT] commit message of iteration 2: "about 320 characters at most" was measured with one-letter names --> FIXED (corrected in iteration 3's message; long-name test)
- [NIT] server.js DM and task routes: answer stamped after the awaited send --> FIXED (time taken before the send; reasoned, a race)
- [NIT] engine/holdtold.js drained-reply comment overstated the floor --> FIXED
- [NIT] engine/tasklist.js toldWords: task show gave the first ask --> FIXED (latest ask)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged**: no new actionable findings.
- [NIT] server.js task route markAnswered: marks answered even when every line was kept --> DEFERRED: the person's words are on the task itself, and a task-conversation message always prompts again, so it self-corrects
- [NIT] engine/holdtold.js header: one long line --> DEFERRED: cosmetic
- [NIT] engine/projects.js / rooms: bare #N --> DEFERRED: duplicate of iteration 2's deliberate choice

#### Found by me, not by a reviewer
- [CONVENTION] .claude/plans/: no plan file during the loop --> FIXED (toldat-8259.md, committed before the final gates)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/holdtold.js noteTold | BRANCH | re-ask never recorded | FIXED | round 1 commit |
| 2 | 1 | WARNING | server.js kept lines | BRANCH | clause on kept lines | FIXED | round 1 commit |
| 3 | 1 | WARNING | web/index.html tskHoldToldWords | BRANCH | slow clock reads not asked | FIXED | round 1 commit |
| 4 | 1 | WARNING | server.js, engine/messages.js | BRANCH | marked when not typed | FIXED | round 1 commit |
| 5 | 2 | WARNING | engine/messages.js room mark | SELF | two holders, one reached | FIXED | round 2 commit |
| 6 | 2 | WARNING | engine/holdtold.js clauseFor | BRANCH | unbounded clause | FIXED | round 2 commit |
| 7 | 3 | WARNING | engine/holdtold.js noteAnswered | SELF | named answer dropped | FIXED | round 3 commit |
| 8 | - | CONVENTION | .claude/plans/ | BRANCH | no plan file | FIXED | plan file commit |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] engine/holdtold.js namedNumbers in rooms: bare #N may be a card number (iterations 2, 4; deferred)
- [NIT] engine/holdtold.js markAnswered: lift and re-hold during one delivery (iteration 2; deferred)
- [NIT] server.js task route: marks answered when every line was kept (iteration 4; deferred, self-corrects)
- [NIT] engine/holdtold.js header: one long line (iteration 4; deferred)

### Strengths (across all iterations)
- Every place onHoldForPerson is dropped also drops the told marks, through one shared field list (iterations 2, 3, 4)
- Nothing in the new code can throw out of a message send (iterations 3, 4)
- Typed text is pane-safe: names plain-worded with bidi marks stripped, ids checked against a slug (iterations 2, 4)
- Each fix landed with a test and a mutation that turns it red (every iteration's commit)
