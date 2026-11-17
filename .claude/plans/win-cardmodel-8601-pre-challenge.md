---
pre_challenge: true
method: challenge-loop
branch: win-cardmodel-8601
diff_hash: 677d3ab8a14ae862361d1f0620771ce9d6f6bdb3473cc027d14c7d9ec144458c
validation: failed (environment: the repo's only real validation step is the full suite, red on main on win32 for Mac-only reasons, kosmos#8378; npm is not on this box. Substitute evidence below)
subdir_audit: passed
timestamp: 2026-11-17T00:18:45Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the fleet's 8-round cap (no BLOCKER open). Round 8's two WARNINGs and its NITs are filed as kosmos#8605 rather than changed after the last review.
**Total findings:** 1 BLOCKER, 13 WARNINGs, 4 CONVENTIONs, about 20 NITs
**Fixed:** every BLOCKER and every WARNING through round 7, plus the CONVENTIONs. **Deferred:** round 2's server-hop test gap, which the existing server.test.js test already covers. **To a card:** round 8 (#8605). **Asked:** 0

Validation note: `validation_log_run_or_skip` cannot pass on this box. The repo's type-check, lint-fix and build scripts are no-op echoes, `test` is the full suite (red on win32 main for Mac-only reasons, #8378), and npm is not on PATH. Substitute evidence, all run with the no-schtasks preload:
- The two new test files plus status.test.js, status.earlier-model-6716, modelname-4416, status.codex-model-switch-4416 and the six policy tests: 357 tests, 340 pass, 0 fail (17 skipped).
- 56 related engine/server test files (status*, modelname*, server.whoami*, render-talk-goldencard), branch against origin/main: the same 10 failures by name on both (round 0), and none in a file this branch touches.
- 8.3 TEMP run of the new tests: pass. The server hop test ("a tied card reports the model its job will start it on, and only when no live model was read") passes on the branch.
- Live on the Windows box, the branch's engine reading the real test agent: before / after a real model change / after changing back (round 1), and a prompt sent after the change (round 4). Scripts work/t8471live/branchread.js and prompt8601c.ps1.
- Each new behaviour was checked by mutation or against older code: no fix (origin/main's status.js) fails the main case; no model comparison fails 4 controls; file time instead of reply time fails 2; round 6 code fails the unknown-family test; round 6 code fails both round 7 tests.
The Mac and Linux arms of the real-job test could not run here; CI is the check.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] status.js readModel: file time alone blanked the model after every job rewrite (Windows stop/start, account moves): ring, whoami, card --> FIXED (a9b3d152f1): the job must also name a different model
- [WARNING] no-`--model` jobs lost the model on every surface --> FIXED (same: a job with no model leaves the reading)
- [WARNING] partial restart / mid-session /model plus rewrite --> narrowed by the model comparison; recorded under Weakest premise
- [WARNING] premise verified only after merge --> FIXED: live check before merge with the branch engine
- [CONVENTION] Mac deviation from the card's control --> FIXED: stated on #8601
- [WARNING] no downstream or side-effect tests --> FIXED: controls for same model, no model, alias, [1m], dated

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] job model only ever stubbed --> FIXED (392adcd8c4): status.cardmodel-realjob-8601.test.js through the real plannedModelOf
- [WARNING] server hop untested --> DEFERRED: pinned by server.test.js "a tied card reports the model its job will start it on, and only when no live model was read" (passes on the branch)
- NITs: ring/whoami comment added; alias spellings and named worlds recorded in the plan

#### Iteration 3
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 2 NITs
- [BLOCKER] the real-job test passed null for tmux, so it would throw on Mac and Linux CI --> FIXED (8a419a30b7): stand-in claude/tmux binaries, as create.compat-7206 does
- [WARNING] writtenBeforeJob's comment still claimed file time means a model change --> FIXED
- [CONVENTION] comments disagreed about what moves the task file's time --> FIXED by measuring: a plain POST /restart does not move it; /Change DISABLE/ENABLE does
- NITs: the mid-reply window was recorded; the unknown dated id was pinned

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] a prompt sent after the change writes to the file before any reply, so the old model came back --> FIXED (4bcc965ed5): timed by the reply row's own timestamp; verified live
- NITs: test titles no longer say "restart"; whoami comment says "or no model"

#### Iteration 5
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] a model not yet in the name table read as different from its dated form --> FIXED (6c3c96095f): snapshot dates set aside; the review 3 test is now a control
- NITs: comments; a test for an unreadable timestamp added

#### Iteration 6
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] modelInText prefers a known id, so after a change to an unknown model the window stayed open through every reply --> FIXED (8960489909): newest reply on any real model; job stat before the tail scan
- NITs: double job read accepted; repeat on Windows stop/start recorded

#### Iteration 7
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] foo / foo-discord: another session sharing the name was judged against that name's job --> FIXED (bc959f8a63): own session only
- NITs: a reply is isReplyLine (API errors do not count); jobExists helper; plan headline updated

#### Iteration 8
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs. Stopped at the cap, all filed as kosmos#8605:
- [WARNING] the job is stat'd twice per poll per tied Claude agent with a job
- [WARNING] the Windows cachedTaskSpec would be stale if a task were rewritten outside the board process (no such path known)
- NITs: no-session reads counted as the agent's own; named-world protection is incidental; a dead `<synthetic>` check; a cut first line falls back to the file time

### Final Ledger

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | file time alone blanks the model after any rewrite | FIXED | a9b3d152f1 |
| 2 | 1 | WARNING | jobs with no --model lose the model | FIXED | a9b3d152f1 |
| 3 | 1 | WARNING | partial restart / mid-session /model | FIXED (narrowed, recorded) | a9b3d152f1 |
| 4 | 1 | WARNING | unverified premise before merge | FIXED | live check |
| 5 | 1 | CONVENTION | Mac deviation from the card's control | FIXED | #8601 comment |
| 6 | 1 | WARNING | no downstream tests | FIXED | controls added |
| 7 | 2 | WARNING | job model only stubbed | FIXED | 392adcd8c4 |
| 8 | 2 | WARNING | server hop untested | DEFERRED | covered by server.test.js |
| 9 | 3 | BLOCKER | real-job test breaks Mac/Linux CI | FIXED | 8a419a30b7 |
| 10 | 3 | WARNING | writtenBeforeJob comment overclaims | FIXED | 8a419a30b7 |
| 11 | 3 | CONVENTION | comments disagree on the task file's time | FIXED | measured, 8a419a30b7 |
| 12 | 4 | WARNING | prompt row brings the old model back | FIXED | 4bcc965ed5 |
| 13 | 5 | WARNING | unknown dated id read as different | FIXED | 6c3c96095f |
| 14 | 6 | WARNING | unknown model family keeps the window open | FIXED | 8960489909 |
| 15 | 7 | WARNING | name-sharing session judged against the job | FIXED | bc959f8a63 |
| 16 | 8 | WARNING | double job stat per poll | TO CARD | #8605 |
| 17 | 8 | WARNING | Windows task cache staleness | TO CARD | #8605 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Round 8 NITs are on #8605. Earlier NITs were applied (comments, test titles, isReplyLine reuse, jobExists) or recorded in the plan's Weakest premise.

### Strengths (across all iterations)
- One job-file lookup is shared with the Codex rule, whose behaviour is unchanged.
- The #6716 earlierSession shape is reused, so every consumer was already correct.
- The rule needs both a stale reading AND a different model, so routine rewrites leave the reading alone.
- Controls and mutations for each case; a real-job test through the platform's own reader.
