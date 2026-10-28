---
pre_challenge: true
method: challenge-loop
branch: newagent-7488
diff_hash: 1240cc2d4c40f1b9c62f78b044917956a73fe4e69ca5ab0f6f44818453c363a1
validation: passed
subdir_audit: passed
timestamp: 2026-10-28T18:41:28Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18 (iteration 1 was the initial validation pass; 2 to 18 were blind reviewers)
**Converged:** Yes (iteration 18's three warnings were all decisions already recorded in the plan and deferred in earlier rounds)
**Total findings:** 4 BLOCKERs, about 65 WARNINGs, 3 CONVENTIONs, many NITs
**Fixed:** all BLOCKERs and nearly all WARNINGs | **Deferred:** 9 (reasons below) | **Asked (awaiting user):** 0

**Validation of record (after rebasing onto origin/main at ad3250e431, six new commits that changed web/index.html and server.js; the short commit refs below are from before that rebase, and the same fixes sit on the rebased branch under new ids):** every iOS logic suite (ios/LogicTests/run*.sh: 99, 83, 65, 108, 564, 42, 108, 103, 1673, all passing), the 16 repo tests that read the iPhone sources (server.ios-routes-6838, fixture-discipline, no-brand-refs, no-name-refs and the ios.* tests: 130/130), and a clean simulator build with no warnings in the touched files. The same set ran after every iteration's commit.

**Self-generated:** not computed by blame per finding. Several later findings were in this loop's own earlier fixes: iteration 13 (comments describing a cancel that iteration 12 removed), iteration 15 (the tint lost when iteration 7 moved the sheet), iteration 17 (iteration 14's case change and its comment). Those prose claims were deleted rather than rewritten.

### Per-Iteration Breakdown

#### Iteration 1 (initial validation)
**Reviewer model:** none (helper failure)
- [BLOCKER] initial-validation: server.ios-routes-6838 could not read the team requests --> FIXED (4f95ef3)

#### Iteration 2
**Reviewer model:** sonnet
- [BLOCKER] NewAgentView: Team Try again re-ran the name check, which refused the team's own names --> FIXED (d1af214)
- [WARNING] duplicate seats crashed the names dictionary; a partial with no sentence read as unknown; Team kept a Swarm kind; the stale-name guard --> FIXED
- [WARNING] (found by the orchestrator from the shots) the pinned button's label was unreadable in dark mode; Swarm missing from the sample --> FIXED (da78413)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] a failed member could not be renamed or adopted; no project tell; role cautions dropped; hello offered for an agent never seen; fields editable mid-run; no folder_taken retry; no VoiceOver announcements --> FIXED (0d8f6dd)
- [CONVENTION] Words.nameMissing unused --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] run not tied to the sheet; rename of a maybe-made row; plan and code disagreed on the 30 s hello --> FIXED (d863b24)
- [WARNING] duplicate names inside a team --> DEFERRED: the board's own name check refuses them in its words

#### Iteration 5
**Reviewer model:** opus
- [WARNING] refusal on re-read shown as unsure; Try again with blank names; VoiceOver could not edit a renamable row; tells lost when the sheet closed early; adopted member never told; guide offered as manager; sheet reopening after a tab change --> FIXED (180773c)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] stale-name guard could refuse a name the board normalised --> FIXED (removed, 18990a3)
- [WARNING] a tell is sent once --> DEFERRED: the desktop's fire-and-forget, recorded in the plan
- [WARNING] a project left when another team is picked --> DEFERRED: the desktop does the same

#### Iteration 7
**Reviewer model:** opus
- [BLOCKER] "seen" meant listed, not running: hello, the tell and adoption fired for a just-made agent with no session --> FIXED (85bdc9f, the desktop's boardCanSeeIt)
- [WARNING] adoption under a renamed name; tab change ended a team run; disabled label contrast; seen test untested --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] team sample lost its lead; hello timer tied to the screen --> FIXED (32f77b8)
- [WARNING] Reports to for deeper teams --> DEFERRED: engine/catalogue.js allows reportsTo only null or 'lead'

#### Iteration 9
**Reviewer model:** opus
- [WARNING] no hint for a blank Role; Say hello on another tab; made warnings dropped; tells across accounts --> FIXED (1ec9229)
- [WARNING] team order not unit-testable --> DEFERRED: view flows are not unit-tested in this app (New project, New task); the pieces are; recorded as the weakest premise

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] Go to your team before the lead was seen; double-tap race; cancelled run left rows Making --> FIXED (3ead230)
- [WARNING] no provider picker --> filed as #7502 (Renet Tilley took it)

#### Iteration 11
**Reviewer model:** opus
- [BLOCKER] the sheet stayed over the Face ID lock and the sign-in screen --> FIXED (71c1a11)
- [WARNING] team lead never seen had no state; roles reload missing on the team screen; names locked after a made project; tells across computers --> FIXED

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] lock mid-team cut the run; Reports to reset by an empty list; lead timer untracked; timers off the main actor; duplicate create after no answer --> FIXED (3b72c2f)

#### Iteration 13
**Reviewer model:** opus
- [WARNING] comments and branch still described cancelling the run; computer change kept the sheet; a second run while the first continued; duplicate project after a lost create --> FIXED (c462e6b)
- [CONVENTION] New project sheet change not in the plan --> FIXED

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] off-screen order read the closed sheet's state; tells kept for ever; header comment wrong about the model --> FIXED (698cf94)
- [WARNING] a hung request --> DEFERRED: the session's request timeout is 15 s (BoardClient+App.swift)

#### Iteration 15
**Reviewer model:** opus
- [WARNING] sheet lost the ink tint (system blue, under AA); lost project looked for under the wrong name; "look in Agents" after reads that make nothing --> FIXED (a63e2cf)

#### Iteration 16
**Reviewer model:** sonnet
- [WARNING] swarmsOn kept from the last computer; gone flag never reset; busy button silent to VoiceOver --> FIXED (0333a73)
- [WARNING] off-screen failures seen only in Agents --> DEFERRED: recorded in the plan

#### Iteration 17
**Reviewer model:** opus
- [WARNING] a failed look still made a second project; the case change and its comment were wrong; two announcements bypassed the guard; no picture for a single agent unrecorded --> FIXED (b7fa90f)

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 after deduplication (3 WARNINGs, each a recorded, deferred decision: the untested team order, off-screen state, the single tell)
**Converged** — no new actionable findings.

### NITs (non-blocking, across all iterations)
- Catalogue.swarms duplicates client.swarmsOn (kept: the design-shot sample sets it).
- The DEBUG sample hook reopens New Agent each time Agents appears (DEBUG only).
- "Describe it yourself" with an emptied box cannot continue, and "Let Kosmos know an agent was created" has no box (both recorded in the plan).

### Strengths (across all iterations)
- Every request is the desktop's own, and every list comes from the board's routes; the phone's words are checked against web/index.html, with a negative control showing a changed word goes red.
- Answers are honest about uncertainty: no answer is "may have been made", a partial is a refusal, a lost create is never re-sent or adopted under another name.
- Sheet lifetime is safe: closed on lock, account change and computer change; tells kept by the app, keyed to the computer, expiring after ten minutes.
