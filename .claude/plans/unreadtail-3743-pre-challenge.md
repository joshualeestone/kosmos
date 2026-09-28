---
pre_challenge: true
method: challenge-loop
branch: unreadtail-3743
diff_hash: 672c51cf248e3647de45ccc26d1b2d8ff774d21b55c841518ea340b28e17bbb9
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T04:12:46Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (iteration 1 is 6.0's fix-and-validate pass; blind reviews ran as iterations 2 to 7)
**Converged:** Yes (iteration 7 returned no BLOCKER, WARNING or CONVENTION)
**Total findings:** 23 (1 BLOCKER, 14 WARNINGs, 1 CONVENTION, 7 NITs recorded as actionable or deferred, plus 2 NITs noted only)
**Fixed:** 17 | **Deferred:** 6 | **Asked (awaiting user):** 0

Validation note: several full-suite runs went red on tests this branch does not touch (a CLI stdin timeout, a secret-mask
timing test, the #2066 source-channel test that boots a server seven times) while the Mac's load average was 14 to 21.
Each failing file passed alone (137/137, 8/8), and the next full run passed. The final 6j gate is a clean full pass on
this HEAD (hash 672c51cf248e).

### Per-Iteration Breakdown

#### Iteration 1 (6.0, initial validation)
**Reviewer model:** none (validation helper)
**New findings:** 1 BLOCKER
**Self-generated:** 0 (6.0's synthetic finding is BRANCH by instruction)
- [BLOCKER] initial-validation: the #2518 browser-check surface gate named render-dm-phone-718.js and render-agentdm-3414.js --> FIXED (92e1d1e0, then 4fb918b0: the trailer must name the check with `.js`; both checks run on the branch, 88 and 40 PASS)

#### Iteration 2
**Reviewer model:** opus (claude-opus-5-5, default)
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html .dmthread: the top stroke of a first bubble was clipped at scroll 0 --> FIXED (4753c837, padding-block; U18b)
- [WARNING] web/index.html: the outline rule's transition outranked the .msg-flash outline fade --> FIXED (4753c837, outline-color kept in the list)
- [WARNING] web/index.html: a V-shaped kink where the wing's rounded inner corner met the bubble --> FIXED (4753c837, the corner is square while unread and rounds after the fade; U17c); the softer concave antialias --> DEFERRED: the mask's 1px ramp matches the ::after's own antialias
- [WARNING] render-unread-edge-3743.js U17 could not tell the curve from the wing's box --> FIXED (4753c837, U17b)
- [NIT] U18 WebKit flake (screenshot before the scroll painted) --> FIXED (4753c837, two frames)
- [NIT] U5 did not pin the ::after delay or the guide bubble --> FIXED (4753c837)
- [NIT] "12px by 16px ellipse" read as diameters --> FIXED (4753c837, "radii")
- [NIT] a filter over a very tall unread message --> DEFERRED: U13's 19,000px message passes; not measured as a cost

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above
- [WARNING] U1 counted the gold colour, not the four offsets --> FIXED (c561b453, exact filter string)
- [WARNING] a flash on an unread bubble faded its outline over 1.2s --> DEFERRED: not an issue; the [data-unread] rule's transition is outline-color only, so the outline leaves at once; the rule added for it was redundant and removed (46578639); U1b pins the behaviour and goes red if the unread rule regains a filter fade
- [WARNING] .msg.ext and data-unread both draw on an external sender's unread message --> DEFERRED: two different facts, both true
- [WARNING] Safari itself unmeasured --> DEFERRED: WebKit is measured in the check every run; real Safari cannot be driven here (the plan's weakest premise)
- [NIT] U17c's margin was one pixel --> noted (addressed in iteration 4)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 2 of the above
- [WARNING] reduced motion did not reach an UNREAD bubble (its rule outranked the list) --> FIXED (8b1f22af; U5b)
- [WARNING] U17c passed by one pixel against a fixed count --> FIXED (8b1f22af, compared with a band further along the same stroke)
- [CONVENTION] the mask ellipse and the ::after radius are written twice with nothing tying them --> FIXED (8b1f22af, U17d)
- [NIT] the comment's reference point did not match `at -4px 0` --> FIXED (8b1f22af)
- [NIT] the plan's done list named too few arms --> FIXED (8b1f22af)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above
- [WARNING] the check ran Chromium only while citing WebKit numbers --> FIXED (2e968bb0, ENGINES = ['chromium', 'webkit'])
- [WARNING] "a read bubble is unchanged" was asserted by nothing --> FIXED (2e968bb0 and f5363b60, U19: mask off vs on changes nothing on a read bubble, light and dark; a wrong ellipse reads 30 and 36 to 38; navy left out because its bubble and ground are within 4 of each other)
- [NIT] the flash override won by source order only --> FIXED (2e968bb0, higher specificity)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] the pixel arms raced the page's 1.2s read clock --> FIXED (f84b137c, the clock paused as the page pauses it; with a simulated 1.5s stall the unpaused arms read 0 and fail, the paused pass)
- [NIT] the engine loop's body was not indented --> FIXED (f84b137c)
- [NIT] U17c's clip used a fractional y --> FIXED (f84b137c)
- [NIT] the plan's "0 differing pixels vs main" overstated what U19 measures --> FIXED (f84b137c)
- [NIT] the .dmthread padding could move a DM layout check --> DEFERRED: render-dm-phone-718 (88), render-agentdm-3414 (40), render-room-scroll (20) and the rest ran green on the padding in iteration 2

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings.
- [NIT] the mask's two layers rely on the default mask-composite --> noted (measured in both engines by U17d and U19)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | (surface gate) | BRANCH | two checks named by the #2518 gate | FIXED | 92e1d1e0, 4fb918b0 |
| 2 | 2 | WARNING | web/index.html .dmthread | BRANCH | top stroke clipped | FIXED | 4753c837 |
| 3 | 2 | WARNING | web/index.html transitions | BRANCH | flash fade cancelled | FIXED | 4753c837 |
| 4 | 2 | WARNING | web/index.html wing corner | BRANCH | kink at the junction | FIXED | 4753c837 |
| 5 | 2 | WARNING | render-unread-edge-3743.js U17 | BRANCH | blind to the mask | FIXED | 4753c837 |
| 6 | 3 | WARNING | render-unread-edge-3743.js U1 | BRANCH | offsets not checked | FIXED | c561b453 |
| 7 | 3 | WARNING | web/index.html flash rule | SELF | flash fade on unread | DEFERRED | not an issue; redundant rule removed (46578639) |
| 8 | 3 | WARNING | web/index.html .msg.ext | BRANCH | two marks together | DEFERRED | both facts true |
| 9 | 3 | WARNING | web/index.html mask | BRANCH | Safari unmeasured | DEFERRED | WebKit measured every run |
| 10 | 4 | WARNING | web/index.html reduced motion | SELF | unread bubble missed | FIXED | 8b1f22af |
| 11 | 4 | WARNING | render-unread-edge-3743.js U17c | SELF | one-pixel margin | FIXED | 8b1f22af |
| 12 | 4 | CONVENTION | web/index.html mask | BRANCH | two carves untied | FIXED | 8b1f22af |
| 13 | 5 | WARNING | render-unread-edge-3743.js | SELF | Chromium only | FIXED | 2e968bb0 |
| 14 | 5 | WARNING | plan / check | BRANCH | read-unchanged unasserted | FIXED | 2e968bb0, f5363b60 |
| 15 | 6 | WARNING | render-unread-edge-3743.js | SELF | race with the read clock | FIXED | f84b137c |

### NITs (non-blocking, across all iterations)
- WebKit U18 flake (iter 2, fixed); U5 coverage (iter 2, fixed); radii wording (iter 2, fixed); filter on a very tall message (iter 2, deferred)
- U17c margin (iter 3, addressed iter 4); comment reference point and plan done list (iter 4, fixed)
- flash specificity tie (iter 5, fixed); loop indent, fractional clip, plan wording (iter 6, fixed); padding and layout checks (iter 6, deferred: measured green)
- default mask-composite relied on (iter 7, noted)

### Strengths (across all iterations)
- A read bubble renders as before: the wing's mask removes only pixels the ground mask already covers, pinned every run by U17d and U19 in two engines
- The fade, the delayed ground-mask return and the delayed corner are sequenced so the fade never outlines the mask's block
- Every pixel arm has a control that can return the dangerous answer (a read bubble, a wrong ellipse, the unpaused clock)
