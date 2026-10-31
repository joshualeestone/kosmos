---
pre_challenge: true
method: challenge-loop
branch: composer-7420
diff_hash: ac90badd7d2bab6bd341a47c14ab878e0342b5b25b27cb0af6fe71c407be5000
validation: passed
subdir_audit: passed
timestamp: 2026-10-29T01:52:25Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (iteration 1 the initial validation; iterations 2 to 8 blind reviewers, alternating sonnet and opus; iteration 2's prompt was the orchestrator's own, iterations 3 to 8 the skill's template)
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 14 WARNINGs, 3 CONVENTIONs, 16 NITs
**Fixed:** 13 | **Deferred:** 4 (reasons below) | **Asked (awaiting user):** 0

**Validation of record (HEAD b8d03a8633, rebased on origin/main 921efc55d2, run 20:4x to 20:52 CDT through the machine's heavy-work queue):** every iOS logic suite (ios/LogicTests/run*.sh: 99, 83, 65, 108, 625, 42, 108, 103, 1673, all passing), the 11 repo tests that read the iPhone sources (82/82), and simulator Debug and Release builds (both succeeded, no errors). Behaviour, same run, iPhone 17 simulator, iOS 27.0: KOSMOS_SAMPLE_SIDEWAYS=5 with KOSMOS_SAMPLE_NOLOCK=1 leaves the list shifted (Josh's screenshot: the agent's bubbles against the edge; record "side offset 16 (left), shift 1"); with the lock it is put back (record "side offset 16, put back, shift 1"; margins normal). Control for the source check: origin/main's ChatView.swift reds it. Shots ~/work/design-shots/kosmos-7420-sidelock, approved by Mona Lisa.

### Per-Iteration Breakdown

#### Iteration 1 (initial validation)
**Reviewer model:** none. Clean baseline.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] ChatView.swift: offset x forced to 0, not the rest (-adjustedContentInset.left); landscape supported --> FIXED (cf2a50eb21)
- [WARNING] ChatView.swift: nearest UIScrollView ancestor may be the wrong one --> DEFERRED: the probe is inside the chat ScrollView's own content, so the nearest UIScrollView ancestor is that list by construction; an outer container is farther up; a wrong match would show in the record
- [NIT] one-frame shifted render before the async put-back; [NIT] off captured at make; [NIT] source checks

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above (the plan's "put back to 0" sentence)
- [WARNING] a cause re-applying every frame wrote a record line per frame --> FIXED (fca81aced4, then e9ec7b0593)
- [WARNING] the NOLOCK control flooded the record the same way --> FIXED (fca81aced4)
- [WARNING] the probe failing to find the list is silent beyond one line --> plan names the simulator run as the only behavioural proof
- [CONVENTION] the plan said "put back to 0" after review 1 changed it --> FIXED (fca81aced4)
- [NIT] no-op alwaysBounceHorizontal dropped; [NIT] Debug offset given from rest --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] the once-per-shift flag not reset on a window move --> FIXED (d84bc8c2a0)
- [WARNING] the put-back can interrupt a fling --> DEFERRED then FIXED in iteration 5's change (the put-back now waits and skips while scrolling)
- [WARNING] wrong scroll view --> duplicate of iteration 2

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] each put-back cleared the once-per-shift flag, so a cause back every frame still filled the record --> FIXED (e9ec7b0593: counted, recorded at shifts 1, 2, 4, 8...)
- [WARNING] a put-back can cut SwiftUI's own animated scroll short --> FIXED (e9ec7b0593: waits 0.35 s, skips while dragging or decelerating)
- [NIT] .initial on the watch; [NIT] the Debug shift given once --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] a fling ending with no further offset change left it shifted --> FIXED (d4488c551a: retried every 0.35 s while scrolling)
- [WARNING] the plan said "at once"; the lock shortens a shift, it does not prevent it --> FIXED (d4488c551a: stated plainly)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] the stack-width trace (added by an earlier session) unbounded --> FIXED (b8d03a8633: removed)
- [WARNING] the lock fighting a cause that keeps re-applying --> DEFERRED as a reading rule in the plan: shift 8, 16, 32 in a Share means not fixed, find the cause
- [CONVENTION] two comments still said "at once" / "back to 0" --> FIXED (b8d03a8633)
- [NIT] a stale retry after a window move --> FIXED (b8d03a8633: generation)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 NEW (2 WARNINGs and 1 CONVENTION, all duplicates of ledger entries), 2 NITs
**Self-generated:** 0 of the above
**Converged.** No new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | WARNING | ios/Kosmos/ChatView.swift (Probe) | BRANCH | x forced to 0, not the rest | FIXED | cf2a50eb21 |
| 2 | 2 | WARNING | ios/Kosmos/ChatView.swift (Probe) | BRANCH | Nearest scroll view may be wrong | DEFERRED | By construction; visible in the record |
| 3 | 3 | WARNING | ios/Kosmos/ChatView.swift (watch) | SELF | Record line per frame | FIXED | fca81aced4, e9ec7b0593 |
| 4 | 3 | WARNING | ios/Kosmos/ChatView.swift (watch) | SELF | NOLOCK control floods the record | FIXED | fca81aced4 |
| 5 | 3 | CONVENTION | .claude/plans/composer-7420.md | SELF | Plan said back to 0 | FIXED | fca81aced4 |
| 6 | 4 | WARNING | ios/Kosmos/ChatView.swift (didMoveToWindow) | SELF | Flag not reset on window move | FIXED | d84bc8c2a0 |
| 7 | 5 | WARNING | ios/Kosmos/ChatView.swift (watch) | SELF | Put-back clears the flag, flood remains | FIXED | e9ec7b0593 |
| 8 | 5 | WARNING | ios/Kosmos/ChatView.swift (watch) | SELF | Put-back cuts a scroll animation | FIXED | e9ec7b0593 |
| 9 | 6 | WARNING | ios/Kosmos/ChatView.swift (putBack) | SELF | Fling end with no retry | FIXED | d4488c551a |
| 10 | 6 | WARNING | .claude/plans/composer-7420.md | SELF | Plan said at once | FIXED | d4488c551a |
| 11 | 7 | WARNING | ios/Kosmos/ChatView.swift:504 | BRANCH | Unbounded stack-width trace | FIXED | b8d03a8633 |
| 12 | 7 | WARNING | ios/Kosmos/ChatView.swift (putBack) | SELF | Lock may fight a re-applying cause | DEFERRED | Reading rule in the plan |
| 13 | 7 | CONVENTION | ios/Kosmos/ChatView.swift:506, 2141 | SELF | Stale comments | FIXED | b8d03a8633 |

### NITs (non-blocking, across all iterations)
- [NIT] one shifted frame before the async put-back (iteration 2)
- [NIT] off captured at make, updateUIView empty (iterations 2 and 7)
- [NIT] exact-string source checks (iterations 2 to 8)
- [NIT] alwaysBounceHorizontal no-op (iteration 3, fixed)
- [NIT] Debug offset from rest, given once; .initial on the watch (iterations 3 and 5, fixed)
- [NIT] shifts kept across windows (iteration 6, commented)
- [NIT] stale retry after a window move (iteration 7, fixed)
- [NIT] putBack declared above the properties it uses (iteration 8)

### Strengths (across all iterations)
- A cause-independent lock with a Debug repro and a Release-off control, measured in both arms in the simulator (iterations 2 to 8)
- The trace allow-list widened to ChatView.trace( writers, numbers only (iterations 3 to 8)
- Bounded recording (powers of two) and a put-back that never fights the person's own scroll (iterations 6 to 8)
- The plan states the weakest premise, what was not verified, and how to read a Share (iterations 3 to 8)
