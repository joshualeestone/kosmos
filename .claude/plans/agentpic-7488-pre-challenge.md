---
pre_challenge: true
method: challenge-loop
branch: agentpic-7488
diff_hash: e8ced009d6d295509ad7815ef4ce000956fe859b77e441a8211e3baf9f4c16dd
validation: passed
subdir_audit: passed
timestamp: 2026-10-28T22:02:15Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18 (iteration 1 was the initial validation pass, clean; iterations 2 to 18 were blind reviewers)
**Converged:** Yes (iteration 18's two warnings were a recorded gap and a spacing the design reviewer approved; its nits were not taken after convergence)
**Total findings:** 0 BLOCKERs, about 60 WARNINGs, 2 CONVENTIONs, many NITs
**Fixed:** nearly all WARNINGs | **Deferred:** 7 (reasons below) | **Asked (awaiting user):** 0

**Validation of record (after rebasing onto origin/main 5b93277dc7, which changed web/index.html and server.js):** every iOS logic suite (ios/LogicTests/run*.sh: 99, 83, 65, 108, 585, 42, 108, 103, 1673, all passing), the 16 repo tests that read the iPhone sources (server.ios-routes-6838 and the ios.* tests among them: 130/130), and a clean simulator build. The same set ran after every iteration's commit, through the machine's heavy-work queue. The drawing half (letter mask, photo fitting) has no unit test; the mark's letter was checked by eye in a simulator shot after each change to the mask (an upright, centred F).

**Commit refs below are from before the final rebase**; the same fixes are on the rebased branch under new ids.

### Per-Iteration Breakdown

#### Iteration 1 (initial validation)
**Reviewer model:** none. Clean baseline.

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] mark redrawn on every redraw; letter mask could be empty (colour key); ink test never compared with a letter; thin photos below the board's 16 px; portraits fetched for every seat and not refitted; picker failure, repeat and race --> FIXED (5348ef5)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] ink test could not fail; non-PNG portraits sent unrefitted; full photo decoded on the main thread; no VoiceOver cue for a chosen photo; mark orientation unverified --> FIXED (a522831; a check shot added)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] comments on the wrong variable; animated or oversized PNG portraits kept; mark drawn on the main thread; plan silent on how the drawing was checked --> FIXED (4b48418)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] picture could go to another computer after a switch; Create during a photo fit; a stale error after a good pick; portrait comments overclaimed --> FIXED (12c9e9e)
- [WARNING] drawing half untested --> DEFERRED: checked by eye in shots, recorded in the plan

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] small photos stretched; a refused picture waited out the retry --> FIXED (de59dc3)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] cancelling the mark task did not stop its draw (comment said it did); turned PNG portraits kept; plan silent on the photo fallback --> FIXED (77cc3e3)
- [WARNING] the routes test --> already run in every validation

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] state written off the main actor; the mark not fitted if ever too big --> FIXED (2346046)
- [WARNING] picture lost if the app is suspended --> DEFERRED: the plan's accepted trade-off, as the project tells

#### Iteration 9
**Reviewer model:** opus
- [WARNING] spinner said Making it; the portrait rule untested; a switch did not stop the portrait and mark work --> FIXED (portrait rule moved to a tested function)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] a failed second pick misreported; mask used luminance not alpha --> FIXED
- [WARNING] mark uploaded with no photo chosen --> DEFERRED: the desktop does the same (PENDING_AVATAR is the mark)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] every WebP portrait flattened on white; mask bitmap format not documented; transparent photos flattened --> FIXED (PNG first for real transparency)

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] transparency read from the format, not the pixels --> FIXED

#### Iteration 13
**Reviewer model:** opus
- [WARNING] pencil cue not tappable; a photo survived a role change; a lost answer let the mark overwrite a photo --> FIXED

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] gray with alpha-only not documented for iOS; a fit landing after a role change --> FIXED (RGBA)

#### Iteration 15
**Reviewer model:** opus
- [WARNING] tap gesture on the whole row fought the text field --> FIXED (the pencil only)
- [WARNING] silent fallback when a photo fails --> DEFERRED: recorded in the plan (the sheet may be closed by then)

#### Iteration 16 (with Mona Lisa's #7487 Settings item added before it)
**Reviewer model:** sonnet
- [WARNING] iOS 16 lost the Settings row's top padding; the silent no-answer case not under Not verified --> FIXED

#### Iteration 17
**Reviewer model:** opus
- [WARNING] a send that never left counted as maybe-set --> FIXED (3f6ebd2)

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 after deduplication (the drawing-test gap, deferred; the Settings bottom spacing, 16 pt where it was about 19, which Mona Lisa approved in the shots)
**Converged** — no new actionable findings.

### NITs (non-blocking)
- The Identity row's ViewThatFits rarely stacks (the button text wraps first); the mark's letter is a whole character where the desktop takes one UTF-16 unit; the pencil makes a team row at least 44 pt.

### Strengths
- The mark is the desktop's number for number (JavaScript's double arithmetic copied), tested against the desktop's own code with and without a letter, and its constants and colours are read from web/index.html.
- The picture is sent only to the computer the agent was made on, after the board sees it, from the app rather than the sheet.
