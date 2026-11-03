---
pre_challenge: true
method: challenge-loop
branch: iosprev-7864
diff_hash: 08d9376cee1d63f89fcbd1877c0faea7091d297a39358c8582eab1d5cd5b717d
validation: passed (iOS: all 10 ios/LogicTests suites PASS, run.sh 1910/1910; xcodebuild Debug iphonesimulator BUILD SUCCEEDED; the node suite not run: the branch changes no file outside ios/ and the plan, and CI runs the iOS logic tests, simulator build and UI tests on the PR)
subdir_audit: passed
timestamp: 2026-11-03T19:17:37Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round review cap (a standing operator rule: past 8 only with a BLOCKER). No round raised a BLOCKER; round 8 (whole branch, nothing pre-cleared) raised two WARNINGs, fixed in 2fe7ff6682 (VoiceOver hears the page's words; a retry comment), and no round 9 ran over that fix.
**Total findings:** 22 actionable WARNINGs and 3 CONVENTIONs across 8 rounds, 0 BLOCKERs, plus NITs
**Fixed:** all but those stated as accepted in the plan | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION (plan exists), NITs
**Self-generated:** 0
- [WARNING] ChatView.swift - "Open link" VoiceOver action on every bubble, dead without a preview --> FIXED (57142f1ef4: only with a preview, unless a message link opens that site)
- [WARNING] BoardClient.swift - pictures kept as PNG up to 900 px, decoded on every draw --> FIXED (57142f1ef4: decoded CGImage, capped)
- [WARNING] LogicTests - the loader untested --> FIXED (57142f1ef4: the thumbnail loader's cases; the test Mac answers the unfurl route)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 2
- [WARNING] a picture evicted while its card is on screen never reloads --> FIXED (task id names whether it is kept)
- [WARNING] UIScreen width in split view --> DEFERRED: the bubbles use the same rule; the card stays aligned with them
- [WARNING] no in-flight sign-out test --> FIXED (tested; the epoch guard's mutation turns it red)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 1
- [WARNING] 40 decoded pictures could reach ~130 MB, no memory-warning handling --> FIXED (4b46826708: cap 12, dropped on a memory warning)
- [WARNING] decode on the main actor --> FIXED (detached, epoch re-checked)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION
**Self-generated:** 2
- [WARNING] a load in flight across a drop is kept --> FIXED (1c8d521f44: drop generation; tested, its mutation red)
- [WARNING] eviction refetch loop with more than 12 cards alive --> DEFERRED: stated in the plan (a LazyVStack keeps a screen's worth)
- [WARNING] cancel path relies on env.send returning nil --> DEFERRED: stated, as the thumbnail loader
- [CONVENTION] "40" left in a comment and the plan --> FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 2
- [WARNING] pictures outlive the chat --> FIXED (d1fae095ba: released on close)
- [WARNING] a card blank after a drop that discarded its in-flight picture --> FIXED (generation in the task id)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 3
- [WARNING] VoiceOver action named from the page's own site name, which a page can make up --> FIXED (a4577139835: the address's own host)
- [WARNING] closing a chat discarded the next chat's in-flight pictures --> FIXED (release without the generation; tested)
- [WARNING] a cancelled load cleared a newer load's asked mark --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION
**Self-generated:** 3
- [WARNING] the generation unpublished, so a drop with nothing cached never reloads --> FIXED (a13c11320c: @Published)
- [WARNING] the card shows a made-up site name --> FIXED (the real host beside it when they differ; tested)
- [WARNING] release overclaimed --> FIXED (comment and plan say what it does)

#### Iteration 8
**Reviewer model:** sonnet (whole branch)
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 1
- [WARNING] VoiceOver never hears the page's words --> FIXED (2fe7ff6682, tested)
- [WARNING] no size cap on the phone --> DEFERRED: the Mac caps the picture at 5 MB (engine/unfurl.js IMAGE_MAX via readCapped) before the phone sees it; stated in the plan
**Stopped at the cap.**

### Outstanding questions (ASKED)
- none

### Mutation evidence (each run, file restored after)
The picture cap never evicting (3 cap checks red); the epoch guard removed (the in-flight sign-out check red); the drop-generation guard removed (the in-flight drop check red).

### Strengths
- The picture is only ever the Mac's own /api/unfurl/image path, pinned to the Mac's host, so the phone never talks to the site; only http(s) addresses open.
- Layout mirrors the board's card (Josh's #761 ruling), shots in light and dark: Files/7864-chat-preview-{light,dark}.png.
