---
pre_challenge: true
method: challenge-loop
branch: restorefollow-7801
diff_hash: 5002d474155ad85c09466a40cd6881cd2242fa42b4de7ab0851bd93acadcb4d9
validation: passed
subdir_audit: passed
timestamp: 2026-11-03T01:22:07Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap by a standing directive: Splinter's review rule (fleetbuilders m510, 2026-10-26 16:07): "A review loop stops at 8 rounds unless a BLOCKER is still open. Past 8, WARNINGs go to a follow-up card, not another round." No BLOCKER was open after iteration 8; its WARNING and NITs are filed as #7816.
**Total findings:** 1 synthetic BLOCKER (final validation), 14 WARNINGs, 4 CONVENTIONs, 20+ NITs
**Fixed:** 17 | **Deferred:** 6 | **Asked (awaiting user):** 0 | **To follow-up #7816:** 1 WARNING, 2 NITs

Final validation on HEAD cbc2e6510a: 26538 tests, 0 failed (validation-log hash 5002d474155a). Both browser-check gates (#1720 coarse, #2518 surface) green.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] web.pbrestore-7404.test.js:351: slow-read test's visibility assertion made vacuous by the never-hidden line --> FIXED (f1b8f4e9): asserts the end words
- [WARNING] web.pbrestore-7404.test.js:145: same, in the paint test --> FIXED (f1b8f4e9)
- [WARNING] web/index.html:56079: forced-read exemption missed both ways (failed own read; refused Stop beside an end) --> FIXED (f1b8f4e9): exemption moved onto the message (PBF.msgRunning)
- [NIT] web/index.html:56085: focus to an empty end line --> FIXED (f1b8f4e9): falls back to See your backups
- [NIT] web.pbrestore-7404.test.js: CSS test reads presence, not cascade --> later FIXED by iteration 4's browser check
- [NIT] web/index.html:56077: comment narrower than the forced reads --> FIXED (rewritten with the new rule)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web.pbrestore-7404.test.js: no test that an END clears a kept restore_running message --> FIXED (f8676b24)
- [NIT] web/index.html:56078: a kept refusal outlives a restore no read saw --> FIXED (f8676b24): any read seeing none running clears it
- [NIT] clearing on a start also clears the person's own See message --> DEFERRED: a missing sentence, never a wrong one (plan)
- [NIT] CSS presence regex; [NIT] :empty depends on '' writes --> noted

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above (the plan's test list, written by f1b8f4e9's era)
- [WARNING] web/index.html:56086: stopped-restore focus to the end line untested --> FIXED (0cd6004c)
- [CONVENTION] .claude/plans/restorefollow-7801.md: test list named the dropped !force guard --> FIXED (0cd6004c): rewritten with each test's mutant
- [NIT] web/index.html:56049: Off kept a kept refusal --> FIXED (0cd6004c)
- [NIT] tabindex on an emptied line; [NIT] mixed boolean forms --> DEFERRED: not regressions, harmless

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web.pbrestore-7404.test.js:419: CSS cascade unguarded (re-raised from iteration 1's NIT, now WARNING) --> FIXED (e9489083): docs/browser-checks/render-pbrestore-end-7801.js, Chromium and WebKit, red on main and with the override removed
- [WARNING] web/index.html:56080: no test that code survives pbPost on a non-ok answer --> FIXED (e9489083)
- [NIT] pbfMsg resets msgRunning silently --> FIXED (e9489083): comment
- [NIT] paint arm vis() vacuous --> DEFERRED: it goes red if lastEl.hidden returns (fakeDoc starts unhidden, the paint would set it)
- [NIT] per-repaint pbfMsg('') in the drop branch --> DEFERRED: idempotent
- Gate (orchestrator): surface gate red on render-cloud-signin-4903.js (token asSentence on pbfMsg's line) --> check ran 50/50, trailer in 4b6e4e26

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above (plan prose)
- [CONVENTION] plan still said the cascade was measured by hand only --> FIXED (9b7ccad8)
- [NIT] test title said "a real 409" --> FIXED (9b7ccad8)
- [NIT] check label claimed the accessibility tree --> FIXED (9b7ccad8)
- [NIT] disabled See as a focus target --> DEFERRED: See is hidden while a restore runs, so it cannot be busy then

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 NEW WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] restore ends and another starts between reads keeps "already running" --> DEFERRED: the message is true then
- [WARNING] start-and-end between two reads is invisible --> DEFERRED: the card's own out-of-scope note, in the plan
- 6d returned zero NEW; 6j final validation then went red:
- [BLOCKER] final-validation: tools.browser-checks-wired (#1387) red: render-pbrestore-end-7801.js not in gated.txt --> FIXED (5c3464a1)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the test comment)
- [WARNING] web/index.html:20538: the always-live end line would read an hours-old end aloud on the first read after a show --> FIXED (3be140be): starts aria-live=off, polite once a paint has shown the answer (PBF.liveReady); mutants red both ways
- [WARNING] web.pbrestore-7404.test.js:379: comment described the rejected forced-read rule --> FIXED (3be140be): cut down
- [WARNING] commit e0704ec8a5 body describes the rejected rule --> FIXED at merge: squash with an explicit --body-file
- [NIT] "real 409" in a commit message --> as above, explicit squash body
- [NIT] pbfMsg(t, running) shape; [NIT] per-paint DOM write --> DEFERRED: ordering is commented and tested

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:56150: a second read with no paint between would flip aria-live and write in one task --> FOLLOW-UP #7816 (the plan's named weakest premise; holds for every caller today)
- [NIT] Off resets liveReady only by the next null-status paint; the Off test clears text itself --> FOLLOW-UP #7816
- [NIT] browser check does not assert aria-live --> FOLLOW-UP #7816
- [NIT] first read after a show clears messages on a start --> DEFERRED: accepted in the plan

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web.pbrestore-7404.test.js:351 | BRANCH | vacuous visibility assertion | FIXED | f1b8f4e9 |
| 2 | 1 | WARNING | web.pbrestore-7404.test.js:145 | BRANCH | vacuous visibility assertion | FIXED | f1b8f4e9 |
| 3 | 1 | WARNING | web/index.html:56079 | BRANCH | exemption on the read, not the message | FIXED | f1b8f4e9 |
| 4 | 2 | WARNING | web.pbrestore-7404.test.js:379 | BRANCH | end clearing a kept refusal untested | FIXED | f8676b24 |
| 5 | 3 | WARNING | web/index.html:56086 | SELF | stopped-restore focus untested | FIXED | 0cd6004c |
| 6 | 3 | CONVENTION | .claude/plans/restorefollow-7801.md | SELF | stale test list | FIXED | 0cd6004c |
| 7 | 4 | WARNING | web.pbrestore-7404.test.js:419 | BRANCH | CSS cascade unguarded | FIXED | e9489083 |
| 8 | 4 | WARNING | web/index.html:56080 | SELF | code passthrough untested | FIXED | e9489083 |
| 9 | 5 | CONVENTION | .claude/plans/restorefollow-7801.md | SELF | plan said by hand only | FIXED | 9b7ccad8 |
| 10 | 6 | WARNING | web/index.html:56081 | SELF | restore swap keeps message | DEFERRED | message true |
| 11 | 6 | WARNING | web/index.html:56081 | BRANCH | start+end between reads | DEFERRED | out of scope, plan |
| 12 | 6 | BLOCKER | final-validation | BRANCH | check not in gated.txt | FIXED | 5c3464a1 |
| 13 | 7 | WARNING | web/index.html:20538 | SELF | old end announced on first read | FIXED | 3be140be |
| 14 | 7 | WARNING | web.pbrestore-7404.test.js:379 | SELF | stale test comment | FIXED | 3be140be |
| 15 | 7 | WARNING | commit e0704ec8a5 | BRANCH | commit body describes rejected rule | FIXED | explicit squash body |
| 16 | 8 | WARNING | web/index.html:56150 | SELF | live flip shares a task with a write if two reads land with no paint | FOLLOW-UP | #7816 |

### NITs (non-blocking, across all iterations)
- CSS test reads presence (1, 2): closed by the browser check (4)
- clearing a start clears the person's own See message (2, 8): accepted
- tabindex on an emptied end line (3)
- mixed boolean forms for running (3)
- per-repaint pbfMsg('') in the drop branch (4, 7)
- pbfMsg(t, running) would make the ordering impossible to get wrong (7)
- Off resets liveReady only via the next paint (8): #7816
- browser check does not assert aria-live (8): #7816

### Strengths (across all iterations)
- The refusal exemption belongs to the message, not a read, and every ordering has a test with a CONTROL that the read landed (2, 3, 6)
- The :empty override follows the page's existing idiom and is measured in a real browser with a control that can fail (4, 5, 7)
- Mutants for every new guard went red, recorded in the plan (1-7)
- No em dashes in any spelling (all)
