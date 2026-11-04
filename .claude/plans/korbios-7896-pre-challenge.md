---
pre_challenge: true
method: challenge-loop
branch: korbios-7896
diff_hash: a17a1ca116b5b1993a9e00ca6a6e692d1eae797f5212457a880d993e3c092e81
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T05:10:47Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. The loop STOPPED AT THE 8-ROUND CAP: round 8 still raised 2 WARNINGs and a CONVENTION. They were
addressed in 8c30e7f49a (the 7 list and Form row orbs centred with Spacers; the 3:1 claim scoped to the dot colour), and
that commit was NOT put through another blind round.
**Total findings:** 24 actionable (0 BLOCKERs, 22 WARNINGs, 2 CONVENTIONs), many NITs
**Addressed:** 24, each in the commit after its round (c9d29e3ad3, 904b17630e, 01c0bd9cf6 with d0419ffa52, 822b6bb88b,
7379a83c8f, 509a6b289b, a14cc018f6 with 459b658f99, 8c30e7f49a) | **Asked (awaiting user):** 0
Two of those commits did not compile when pushed (01c0bd9cf6, a14cc018f6); each was fixed by the next commit within minutes.

Final validation on 8c30e7f49a PASSED: validation-log hash a17a1ca116b5 (matches the diff_hash above), 26877 node tests,
0 failed, 0 cancelled; subdir audit exit 0. Also on that head: `xcrun --sdk iphonesimulator swiftc -typecheck -target
arm64-apple-ios16.0-simulator ios/Kosmos/*.swift` exit 0, and all 10 ios/LogicTests suites VERDICT PASS (orb included).
git merge-tree against origin/main (with slice 1, #7906, merged) is clean.

The desktop parity numbers the orb test pins were taken from korb-7896 at a73b486bde. Measured after slice 1 merged:
git diff a73b486bde 3cf8064ae2 -- web/index.html changes only the resize listener's name, so the pinned geometry is the
merged geometry and needs no re-pin.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
- [WARNING] KosmosOrb.swift - #D6A62E on the light grounds measures about 2.1:1 --> ADDRESSED (c9d29e3ad3): Palette.starGold, deep gold in light
- [WARNING] KosmosOrb.swift - "TimelineView stops when not shown" stated as fact --> ADDRESSED (c9d29e3ad3): stated as not verified

#### Iteration 2
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION
- [WARNING] 7 bare orbs in List and Form rows changed layout --> ADDRESSED: reasoned and recorded (finally centred in round 8)
- [WARNING] place() per orb per frame --> ADDRESSED (904b17630e): one shared placing per frame
- [WARNING] dots and cuts built on the main thread on first use --> ADDRESSED (904b17630e): OrbLogic.warm off the main thread at launch
- [WARNING] 16 pt dots under a pixel --> ADDRESSED (904b17630e): sub-pixel dots filled as squares of the same area
- [CONVENTION] plan did not mention the row layout change --> ADDRESSED

#### Iteration 3
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs
- [WARNING] shared placing state with no isolation --> ADDRESSED (01c0bd9cf6, d0419ffa52): main-actor placing
- [WARNING] CPU fill cost against a compositor spinner --> ADDRESSED (01c0bd9cf6): fill measured; 15 fps
- [WARNING] plan claimed the view stops off screen --> ADDRESSED (01c0bd9cf6): weakest premise
- [WARNING] no assertion read a radius --> ADDRESSED (01c0bd9cf6): radius floor asserted

#### Iteration 4
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs
- [WARNING] "under a pixel across" comment vs radius test --> ADDRESSED (822b6bb88b)
- [WARNING] orbs at 15 and 30 fps could not share one placing --> ADDRESSED (822b6bb88b): one rate
- [WARNING] plan on the 7 row orbs --> ADDRESSED (822b6bb88b)

#### Iteration 5
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs
- [WARNING] 7 row orbs --> ADDRESSED (7379a83c8f): recorded as a TestFlight follow-up
- [WARNING] parity numbers pinned from an unmerged branch --> ADDRESSED: recorded; now measured equal to merged main (above)
- [WARNING] "30 frames a second" stale --> ADDRESSED (7379a83c8f): 15

#### Iteration 6
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
- [WARNING] .opacity on disabled dims the only working signal --> ADDRESSED (509a6b289b)
- [WARNING] grouping per orb per frame --> ADDRESSED (509a6b289b)

#### Iteration 7
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
- [WARNING] sign-in Confirm: the orb on a disabled grey fill --> ADDRESSED (a14cc018f6, 459b658f99): Palette.secondary
- [WARNING] row orbs leading vs centred --> ADDRESSED (a14cc018f6)

#### Iteration 8
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION
- [WARNING] the 3:1 claim is about the dot colour, not the drawn orb --> ADDRESSED (8c30e7f49a), UNREVIEWED
- [WARNING] the 7 row orbs sit leading --> ADDRESSED (8c30e7f49a): centred with Spacers, UNREVIEWED
- [CONVENTION] the reviewer could not run the iOS typecheck --> run here on the final head: exit 0

### Weakest premise
Frame cost and how faint the 16 pt orb reads on an older iPhone; neither is measured on a device.
