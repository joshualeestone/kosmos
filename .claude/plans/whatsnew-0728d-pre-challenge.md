---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0728d
diff_hash: 0d75d4296b374d9e507cdaacbd2bf5aa4a30364585a4f0ccf24af254b18ea99d
validation: passed (release notes only: web/whats-new.json and the plan. node tools/whats-new-check.js 0.7.28 passes, 5 highlights, mac 5, windows 4. Entry 5's feature (#5481, PR #5504) is on main and not in the 0.7.27 pin f443ad947 (git merge-base --is-ancestor). Copy is Mona's title (17:17) and line, with "turned off for Kosmos" from review round 1)
subdir_audit: passed
timestamp: 2026-10-07T22:19:41Z
iterations: 2
converged: true
---


## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (sonnet, opus; each a fresh blind agent), checked against PR #5504's code on main
**Converged:** Yes (iteration 2: no BLOCKER, WARNING or CONVENTION; 2 NITs deferred with reasons)
**Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] "is off" overclaims: a mic restricted by Screen Time or a profile, or never asked, gets a sentence and no pill --> FIXED: "is turned off for Kosmos" (the pill shows only for mic-denied / speech-denied)
- [NIT] under 480px or in a text field the visible label is "Settings" (aria-label stays "Turn on in Settings") --> DEFERRED: the Mac app's normal window shows it whole
- [NIT] the plan said main.swift draws the pill --> FIXED: web/index.html draws it, main.swift opens the pane

#### Iteration 2
**Reviewer model:** opus
- [NIT] the pill appears after the person presses the mic and is refused, not before --> DEFERRED: no room in 140, and a person who never presses it never needs the pill
- [NIT] the narrow-label NIT from iteration 1 is still open --> DEFERRED (same reason)

### Strengths
- [STRENGTH] the title says only what the click does; the person still flips the switch in System Settings
- [STRENGTH] the unwatched round trip (the mic restarting by itself) is not promised
- [STRENGTH] Mac-only is right: only the Mac VoiceBridge sends canOpenSettings
