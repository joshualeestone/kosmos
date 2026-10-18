---
pre_challenge: true
method: challenge-loop
branch: backhome-6411
diff_hash: f3fa63481a09d8cfa1cbc4a49ec882d78e14fcdbdaad386fc34f66a2c2587918
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T03:40:26Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Total findings:** 0 BLOCKERs, 21 WARNINGs, 0 CONVENTIONs across 10 iterations (plus 21 NITs)
**Fixed:** 20 WARNINGs | **Deferred:** 1 WARNING (below) | **Asked:** 0

Iterations 1 and 2 reviewed the branch before it was rebased onto main; iterations 3 to 10 reviewed the rebased
branch. The branch was then squashed to one commit (ca39783a86) whose tree is identical to d58399e3c8, the commit
iteration 10 reviewed and validation ran on.

Validation (6j): through queued-heavy at d58399e3c8 (same tree as the squash): `node --test` over the 26 test files in
the validation list (the existing test files that read native-app/main.swift, including the two this branch edits,
native-app.computer-mode-4356.test.js and native-app.download-5167.test.js) exited 0 (TEST_EXIT=0; per-file counts
are not in that log, and CI on the PR counts them); swiftc of native-app/main.swift at the macOS floor: 0 errors;
`--kosmos-app-mode-selftest`: all good (154 rows), SELFTEST_EXIT=0. The new native-app.backhome-6411.test.js was not
in that list and was not run locally; CI on the PR runs it.


Added after the proof was first written: the branch's own native-app.backhome-6411.test.js was missing from the validation script's fixed file list, so it was then run on its own through queued-heavy at ff57aec4 (the squash plus this proof; same code), together with the two count pins and native-app.cmdcomma-6411.test.js: 66 tests, 66 pass, 0 fail (NEW_EXIT=0).

### Per-Iteration Breakdown

#### Iteration 1 (pre-rebase branch)
**Reviewer model:** opus
- [WARNING] the comment said a hidden item's shortcut can still fire; NSMenuItem.h says it is ignored --> FIXED (the
  comment now says it is ignored, so the shortcut works exactly while the item shows; the re-check covers a stale
  shown item)
- [WARNING] the test header and plan repeated the same premise --> FIXED
- [WARNING] a failed start from the item got the launch wording --> FIXED (BoardStartOrigin: a start from the item
  has its own origin)
- [WARNING] no hold while an update is copying files in --> FIXED (runAgentsHere's update hold and "One moment" alert)
- 3 NITs: non-blocking

#### Iteration 2 (pre-rebase branch)
**Reviewer model:** sonnet
- [WARNING] the failure alert said Cmd-R, which on another computer's page reloads that page --> FIXED (a start from
  the item says to choose it again, boardStartRetry)
- [WARNING] the boardRecoveryIsUserInitiated comment's caller list was stale --> FIXED
- 2 NITs: non-blocking

#### Iteration 3
**Reviewer model:** opus
- [WARNING] the claimed launch wording does not hold after any Reload (the flag is never reset) --> FIXED (the origin
  is captured per start from boardStartFromBackHome)
- [WARNING] the 300 s watchdog still said Cmd-R for a start from the item --> FIXED (the watchdog follows the origin)
- [WARNING] reinstall as the only remedy for a mid-session start --> FIXED (a start from the item says what Reload's
  does, differing only in the retry step)
- 2 NITs: non-blocking

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] the item stays shown during a start and a press beeps, which the comment did not say --> FIXED (the
  comment and plan state it; not disabled, by decision)
- [WARNING] "choose it again" depends on the item still being shown after the failure --> FIXED
  (boardStartAdviceOrigin, with selftest rows)
- 2 NITs: non-blocking

#### Iteration 5
**Reviewer model:** opus
- [WARNING] the back-home failure dropped the install fallback --> FIXED (one string for Reload and back home)
- [WARNING] the watchdog comment still said the next Cmd-R reaches the board --> FIXED
- 2 NITs: non-blocking

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] the advice points at a hidden item if the page process ended --> FIXED (Reload's advice when the item has
  gone)
- [WARNING] a seven-term selftest expression risked the type checker --> FIXED (named Bools; compiled, 154 rows)
- [WARNING] the "before any return" pin was weaker than its comment --> FIXED (the origin is read and the marker
  cleared at the top of loadBoard, and the pin rejects any `return` before the clear)
- 2 NITs: non-blocking

#### Iteration 7
**Reviewer model:** opus
- [WARNING] the fallback claimed Cmd-R on the blank window starts the board; it reloads the other computer's page
  --> FIXED (described as two steps: Cmd-R brings the item back, choosing it starts the board)
- 2 NITs: non-blocking

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] "Cmd-R reloads that page and starts nothing" ignores the navigation-failure fall-through --> FIXED
  ("usually", naming recoverOnReloadFailure)
- [WARNING] the item can be gone for reasons other than the page process ending --> FIXED (each listed in
  boardStartAdviceOrigin's comment and the plan)
- [WARNING] the two-step claim rests on backForwardList.currentItem surviving a content-process end --> DEFERRED:
  the plan's weakest premise; reasoned from WebKit behaviour, not measured, and a one-step answer needs a change to
  how a crashed page is handled, too wide for a case this rare
- 3 NITs: non-blocking

#### Iteration 9
**Reviewer model:** opus
- [WARNING] the comment said no alert shows when the mode became connect; the watchdog still does --> FIXED (the
  comment and plan say so; older behaviour, left)
- 1 NIT: non-blocking

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (the origin captured before the connect guard; the
weakest-premise paragraph rests on unmeasured WebKit behaviour, as it says)
**Converged**: no new actionable findings.

### Strengths
- One pure rule (showsAnotherComputer) for when the item shows, and the retry advice written once (boardStartRetry,
  boardStartFailureRemedy, boardStartAdviceOrigin), each with self-test rows that fail when it breaks.
