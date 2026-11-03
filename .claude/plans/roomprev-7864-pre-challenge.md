---
pre_challenge: true
method: challenge-loop
branch: roomprev-7864
diff_hash: 5decfbfeb6c22720217cd8da7240d29afd718d2df9250e04d201a5309e573852
validation: passed (iOS: all 10 ios/LogicTests suites PASS on 93b769cdda, run-room.sh 809/809, run.sh 1913/1913; server.ios-routes-6838.test.js 5/5; xcodebuild Debug iphonesimulator BUILD SUCCEEDED; the node suite not run: the branch changes no file outside ios/ and the plan, and CI runs the iOS logic tests, simulator build and UI tests on the PR)
subdir_audit: passed
timestamp: 2026-11-03T21:06:42Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes. Iteration 4 raised one WARNING that deduplicates against an accepted item (the card's screen-based width, measured to fit at 320 pt in iteration 1 and stated in the plan for iPad split view) and NITs; the one plan nit was fixed (93b769cdda).
**Total findings:** 1 BLOCKER, 8 WARNINGs, NITs | **Fixed:** the BLOCKER and 5 WARNINGs | **Deferred:** 3 WARNINGs, stated in the plan | **Asked:** 0

**Not verified on a device:** the VoiceOver behaviour (the card read as words inside the post, the do-nothing default, the one "Open link" action) is reasoned from the code, this file's file-card precedent and Apple's documentation; no VoiceOver or Accessibility Inspector run. Stated in the plan.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] RoomView.swift - the card a Button inside the post's `.combine` element: raw page text read, a second link action, double-tap ambiguity --> FIXED (f86376764f: read as the chat's spoken line; later completed in iteration 3)
- [WARNING] RoomView.swift - the room releasing pictures when a member's chat opens from it --> FIXED (f86376764f: guarded; replaced in iteration 2)
- [NIT] shared previewTaskKey; a later poll's preview replacing the row; the memory hook's placement --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 1
- [WARNING] RoomView.swift - releasing on leaving the room dropped pictures a chat on another tab was showing --> FIXED (5d8b0d1639: the room no longer releases)
- [WARNING] more than 12 visible cards could evict and refetch in turn --> DEFERRED: stated in the plan (a phone screen shows a few)
- [WARNING] a load in flight across a release still lands --> DEFERRED: stated, as in the chat

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, NITs
**Self-generated:** 1
- [BLOCKER] RoomView.swift - `.ignore` on the card's Button itself keeps its button trait and action, so a VoiceOver double-tap on a post could open the site --> FIXED (4612e00751: the card wrapped in a container first, as the file cards; a do-nothing default on a post with a card, the chat's #7014 rule)
- [WARNING] the card sized from the screen, not the window --> DEFERRED: as the bubble and the chat; stated
- [WARNING] two memory-warning observers when a room and a chat are both alive --> DEFERRED: a harmless double drop; stated
- [NIT] the debug sample picture gated on the sample board; the cache comment names both views --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 NEW WARNINGs (its width WARNING is iteration 3's deferral), NITs
**Self-generated:** 0
- [NIT] the plan should say a reply with a card keeps the reply's default --> FIXED (93b769cdda)
**Converged.**

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | RoomView.swift | BRANCH | card a button in the post | FIXED | f86376764f, 4612e00751 |
| 2 | 2 | WARNING | RoomView.swift | SELF | release dropped another tab's pictures | FIXED | 5d8b0d1639 |
| 3 | 3 | BLOCKER | RoomView.swift | SELF | double-tap could open the site | FIXED | 4612e00751 |
| 4 | 2 | WARNING | BoardClient.swift | BRANCH | >12 visible cards refetch | DEFERRED | stated |
| 5 | 3 | WARNING | RoomView.swift | BRANCH | screen-based width | DEFERRED | stated |

### Outstanding questions (ASKED)
- none

### Strengths
- An outside row never reads a preview (the board never fetches for one, #3311), tested with a control.
- Reuses slice 1's parser, card, loader and cap as they are; the picture task id is one shared function, tested.
- Shots, light and dark: Files/7864-room-preview-{light,dark}.png.
