---
pre_challenge: true
method: challenge-loop
branch: selfrelaunch-4347
diff_hash: e7f5d8e3e13d3b5872e144390380282e37a71e13956d5bb385e257272cfbc36a
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T17:47:06Z
iterations: 15
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 15 (iteration 1 is 6.0's fix-and-validate pass; blind reviews ran as iterations 2 to 15)
**Converged:** Yes
**Total findings:** 2 BLOCKERs (the 6.0 validation failure and iteration 3's gate), 39 WARNINGs, 9 CONVENTIONs, plus NITs, across 14 blind reviews (counted from the breakdown below)
**Fixed:** every WARNING/CONVENTION except those deferred below | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0)
**Reviewer model:** none (initial validation)
**Self-generated:** 0 (synthetic, BRANCH by instruction)
- [BLOCKER] initial-validation: #1290 "this Mac" in the new notice --> FIXED (e7f6ff5)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 6 WARNINGs, 3 CONVENTIONs
**Self-generated:** 0
- JS error read as "cannot tell"; Return on Restart can lose a draft; words left or a throwing check held the update forever; give-up notice every launch; exact-match wait failed when the board moved on; stale comments; compiler warning --> FIXED (e3c393f)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER (coarse browser-check gate), 2 WARNINGs
- Browser-check trailer --> FIXED (5a22047); evaluateJavaScript with no timeout --> FIXED (20 s re-ask)
- Main-thread plist reads --> DEFERRED: three tiny local plist reads per 3 to 30 s, bounded

#### Iteration 4
**Reviewer model:** opus
**New findings:** 5 WARNINGs, 2 CONVENTIONs
- Loading page asked the person; permanent give-up; Return with words waiting; name drift untested; native modal ignored; stale comments --> FIXED (5f0c01a; name-tie test, mutation red)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs
- Not Now stopped the restart for good; a transient unreadable plist reset the ask clock --> FIXED (ddcef17)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 4 WARNINGs
- Modal escalated into a second dialog; file picker not modal; the ask repeated every 10 minutes; words-lost copy when only What's New was open --> FIXED (4bb4fab; ask at most once, mutation red)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 CONVENTIONs
- Give-up after the new app was seen then briefly unreadable --> FIXED (679a8ca; seenFresh, mutation red); stale selftest and plan wording --> FIXED

#### Iteration 8
**Reviewer model:** opus
**New findings:** 3 WARNINGs
- Restart during What's New's decision lost it; What's New open led to the ask; restart right after a click --> FIXED (43a8d66; "hold" answer, mutation red)

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs
- Page error unlogged; hung What's New fetch held forever; second prompt after the notice; unasked failure alert --> FIXED (51de804)

#### Iteration 10
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 1 CONVENTION
- Dialog opened while the page answered; silent failure left the window stuck --> FIXED (08f447e; own-dialog recheck, 3 quiet retries)

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 1 WARNING
**Self-generated:** 1 (code, not prose: the silent retry latched askedBefore)
- --> FIXED (969d617; the real value is carried through)

#### Iteration 12
**Reviewer model:** opus
**New findings:** 3 WARNINGs
- Sleep made the wall clock pass the limit --> FIXED (systemUptime); another account's newer app beat an exact match --> FIXED (exact first, mutation red)
- Behaviour not measured --> DEFERRED as reporting: stated in the plan, the card and the PR; it needs a real update from a build containing this

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 1 CONVENTION
- Strong self in the page-answer completion --> FIXED; stale field name in a comment --> FIXED
- Asked vs silent failure asymmetry --> DEFERRED: deliberate, documented in the code and the plan

#### Iteration 14
**Reviewer model:** opus
**New findings:** 2 WARNINGs
- Silent restart took focus from another app --> FIXED (d40c384; waits for 30 s of system-wide idle when Kosmos is not in front; the idle call measured on this Mac)
- Return on Restart when the page cannot tell --> DEFERRED: duplicate of the iteration 2 and 4 decision (Josh asked for Restart as the blue default; no Return when words are known to wait)

#### Iteration 15
**Reviewer model:** sonnet
**New findings:** 0 after deduplication
- Limits judged up to 20 s late --> DEFERRED: soft limits, corrects on the next poll
- Main-thread plist reads --> duplicate of iteration 3's deferral
**Converged** - no new actionable findings.

### Deferred, with reasons (for the reader who wants to overturn one)
- Main-thread plist reads (iterations 3, 15): tiny local reads, bounded in time.
- Behaviour not yet observed (iteration 12): cannot be observed until the update after this ships; the timestamped `relaunch:` log lines make it countable.
- Asked-restart failure keeps the #1182 marker (iteration 13): unchanged from before this card, stated.
- Return on Restart when the page cannot tell (iteration 14): Josh's blue default.
- Soft-limit lateness (iteration 15).

### NITs (non-blocking, across all iterations)
- Duplicate candidate path read; comment wrap; selftest count omits button rows (pre-existing); test constants restated rather than lifted; evaluateJavaScript calls can pile up on a wedged page; NSMenu not treated as a dialog; What's New pending flag is a boolean; returnIndex and restartIndex are the same value.

### Strengths (across all iterations)
- The decision is a pure function with 62 selftest rows; the on-disk plist read is proven against a cached Bundle.
- The page contract is pinned from both sides by a cross-file test; every mutation of a fix went red.
- The #1182 loop bound, #2094 target choice and #2124 handoff are preserved.
