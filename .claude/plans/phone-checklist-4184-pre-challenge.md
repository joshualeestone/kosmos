---
pre_challenge: true
method: challenge-loop
branch: phone-checklist-4184
diff_hash: 7a28e6581f0f38e495eb432eff9e55ccd44835c4908f436d966c99f5c54081ee
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T14:20:39Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes, at iteration 8
**Total findings:** 3 BLOCKERs, 25 WARNINGs, 1 CONVENTION, many NITs
**Fixed:** all BLOCKERs, WARNINGs and the CONVENTION | **Deferred:** 0 | **Asked (awaiting user):** 0

The change is documentation for a non-engineer (Josh's first phone test), so every finding is about
accuracy against the cards, the code and the live service, or about safety. Validation: full `yarn
test`, gated on tools/heavy-gate.sh: 10877 tests, 10714 pass, 0 fail (hash 7a28e6581f0f, clean).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [BLOCKER] step 6: notifications presented as working now; engine/phonenotify.js PHONE_APP_CAN_RECEIVE is false --> FIXED (c05498dcf)
- [BLOCKER] a certificate warning presented as expected; that note is dev-mode only (DEV_NOTICE) --> FIXED (c05498dcf): "stop and screenshot"
- [WARNING] full screen also needs the Mac piece (relay #161) --> FIXED
- [WARNING] the in-app tap needs the Mac's gate change and the app opened once after the update --> FIXED
- [WARNING] "ready" overstated for Kano's part --> FIXED
- [WARNING] #4086 phone states had no step --> FIXED (Mac-asleep step)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2 (table and citation written by iteration 1's fix)
- [WARNING] step 9 both "waiting" and "works now" --> FIXED (a6d5acc07)
- [WARNING] #4171 cited for the Mac half; it is relay #174 (#4140) --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2
- [WARNING] stale "set up at kosmosplus.com" wording --> FIXED (48fe9572f)
- [WARNING] step 8 heading missed the Mac update --> FIXED
- [WARNING] the new tap can lag up to a day (no skipWaiting) --> FIXED ("up to a day")
- [WARNING] relay #161 probably already on Macs at 0.6.97+ --> FIXED ("probably", ask the version)
- [WARNING] Back, stacking and rotation checks missing --> FIXED (step 11)
- [CONVENTION] #2854 cited for the Mac allow card --> FIXED (#718)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (both facts that changed minutes earlier)
- relay #174 merged; the Mac-asleep wording decided --> FIXED (777077189)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 5 NITs
**Self-generated:** 1
- reopening from the icon may not reach the sign-in page; the Mac setting is "Computer"; the five-minute limit per agent; the in-between state where the board opens on its home; one server update --> FIXED (620d9014a)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION
**Self-generated:** 1 (the BLOCKER was a prediction added in iteration 5)
- [BLOCKER] the Mac-asleep step predicted the native page, which cannot appear from Open my Kosmos --> FIXED (fb3697cbb): no prediction
- [WARNING] "Running in Chrome" uncited --> FIXED
- [CONVENTION] android/README.md "Where a tap goes" stale --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 7 NITs
**Self-generated:** 2 (the README paragraph written in iteration 6)
- today the board opens by itself after the Mac allows; close Kosmos before the offline check; Chrome's one-time notice; README "full screen" not yet seen; README's reason for the URL bar --> FIXED (167b8df50), with the vc3 evidence cited after a rebase

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged:** no new actionable findings. The reviewer checked every claim against the live service (build 660ef70), kosmos main, relay origin/main and the evidence screenshots.

### Final Ledger (actionable findings, grouped)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | phone-test-checklist.md | BRANCH | notifications presented as working | FIXED | c05498dcf |
| 2 | 1 | BLOCKER | phone-test-checklist.md | BRANCH | certificate warning presented as expected | FIXED | c05498dcf |
| 3 | 6 | BLOCKER | phone-test-checklist.md | SELF | wrong predicted screen when the Mac sleeps | FIXED | fb3697cbb (claim deleted) |
| 4 | 1-7 | WARNING (25) | checklist, README | mixed | accuracy and completeness, listed per iteration above | FIXED | see iterations |
| 5 | 6 | CONVENTION | android/README.md | BRANCH | stale "Where a tap goes" | FIXED | fb3697cbb, 167b8df50 |

### NITs (non-blocking, left as is)
- the "Running in Chrome" citation points at cct-warmup-4109; native-fallback-4088 also shows it (iteration 8)
- relay #170 changes one plain-http page a phone could see in an edge case the script does not reach (iteration 8)
- #4184 lists #170 with the coordinator deploy; it is a relay binary change (iteration 8)

### Strengths
- Every quoted on-screen sentence matches the live page or relay main word for word (iterations 3 to 8)
- Safety habits: stop at any certificate warning; allow the phone only on a matching code; "install anyway" only for this file (iterations 3 to 8)
- Every "wait for" gate verified against the live build and main (iterations 4, 5, 8)
