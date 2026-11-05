---
pre_challenge: true
method: challenge-loop
branch: recentphotos-8045
diff_hash: 0414a704a4fc7a1517632a1c26c32f708c26ede453a29c2d5bc56cf6494122e4
validation: 8 failures under load, none in files this branch touches; those six files passed alone
subdir_audit: passed
timestamp: 2026-11-05T21:36:44Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the standing 8-round cap (Splinter, 2026-10-31: 8 rounds unless a BLOCKER is open, leftovers recorded). No BLOCKER open. No round returned zero findings, so the field says false.
**Total findings:** 2 BLOCKERs, 44 WARNINGs, 4 CONVENTIONs, about 35 NITs
**Fixed:** about 26 | **Deferred:** about 20, reasons below | **Asked:** 0

**Validation, stated exactly.** Full suite at 679cc2927d: 27362 tests, 26944 pass, 8 fail, REAL_EXIT=1, during a load spike (load over 100). The 8 are in engine/remote, supervisor.provider-key-inject-3296, supervisor.retire-token-4530, tools.build-linux-7281, tools.no-phone-home-4253 and tools.plus-signin-2036, none touched here. All six passed alone afterward. After that: squashed to one commit and rebased on main (one test-file conflict, both sides kept); logic suites 2048, 835, 61, 119 pass and the privacy check passes on that commit. UI at d0ff8d81da or later: 28 of 28 (AttachMenu 14, real-library 2, KeyboardSlide 9, RoomKeyboard 3). The full suite was not rerun after the rebase; CI runs it.

**Motion:** read frame by frame from simulator recordings: the box holds still both ways, the keyboard slides off and rises over the grid, no-keyboard slides up with the newest in view.
**Not seen:** a real iPhone, real Select Photos, a real camera. The card's done line needs those.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 9 WARNINGs, 8 NITs
**Self-generated:** 0
- [BLOCKER] ios/Kosmos/ChatView.swift - a queued tile read the account at its turn, so it could go up under another account --> FIXED (each tap's add starts at once)
- [WARNING] ios/Kosmos/AttachMenu.swift - the stop x and the Send gate could not see queued tiles --> FIXED (same)
- [WARNING] ios/Kosmos/AttachMenu.swift - stale focus in the timer; keyboard height flips; rotation --> FIXED
- [WARNING] ios/Kosmos/ChatView.swift - closing with no keyboard skipped the #7420 look --> FIXED
- [WARNING] ios/Kosmos/AttachMenu.swift - location removal had no test --> FIXED (Board.trayEncoded, real bytes)
- [WARNING] ios/Kosmos/AttachMenu.swift - take-back leaves the file on the Mac --> DEFERRED: same as the chip's x today, on the card and plan
- [WARNING] ios/KosmosUITests/AttachMenuUITests.swift - box check can miss one frame --> DEFERRED: the video read is the measure

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 6 WARNINGs, 5 NITs
**Self-generated:** 2
- [WARNING] ios/Kosmos/AttachMenu.swift - a second Photos answer could crash; slow keyboard tripped the timer --> FIXED
- [WARNING] thumbnails may use the network --> DEFERRED: tiles drawn only, phone check decides, in the plan
- [WARNING] GIF kept whole; alpha flattened --> DEFERRED: a GIF rarely carries a location, stated in the label; photos rarely have alpha

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 8 WARNINGs, 6 NITs
**Self-generated:** 3
- [BLOCKER] ios/Kosmos/ChatView.swift - + from search left its keyboard up over the tray --> FIXED, UI check added
- [WARNING] ios/store/privacy-label.md - reviewer notes said nothing is read from the library --> FIXED
- [WARNING] timer order, delayed scrolls, concurrent decode, thin fixtures, a tile stuck after the x --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 6 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 3
- [WARNING] retap race; a stale keyboard flag; padding at large text --> FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 7 WARNINGs, 12 NITs
**Self-generated:** 3
- [WARNING] a tile lost its check during the picture copy; height reset every launch; late did-show closed the tray; usage-string check missed the key --> FIXED
- [WARNING] Send is a third tap against the card's two --> DEFERRED: a call on the card, mis-tapped private photos; one line to change if Josh asks

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 5 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2
- [WARNING] ios/Kosmos/AttachMenu.swift - permission could be asked repeatedly --> FIXED
- [WARNING] memory with many tiles --> DEFERRED: capped at ten files, one decode at a time

#### Iteration 7
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 1 CONVENTION, 7 NITs
**Self-generated:** 2
- [WARNING] ios/Kosmos/RoomView.swift - the follow re-read the end after the shrink --> FIXED
- [WARNING] second tap in flight was dropped; tile logic untested --> FIXED (TrayTaps, logic tests)
- [WARNING] ios/LogicTests/main.swift - a forced unwrap on the HEIC encoder --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 5 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1
- [WARNING] ios/Kosmos/AttachMenu.swift - a withdrawn add lost if the chat closes --> FIXED
- [WARNING] plan understated the thumbnails; GIF in the label --> FIXED
- [WARNING] manifest has no photos entry --> DEFERRED: not collected, goes to the person's own Mac, as before

#### After the loop
CI's UI job was red on PR #8065: AttachMenuUITests.testTheBoxHoldsThroughTheSwapInAChat, "too few readings", one reading in 1.2 s on a loaded runner. The check's own floor, not the tray. It now reads for at least 1.2 s and at least four times. Test-only change, no further review round.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- Two stacked modifiers, kept so an older guard's strings stay true
- Landscape tray height is capped, not matched
- A very large photo is a brief memory peak

### Strengths
- A photo's bytes are read in one place, on the tap, and a check pins it
- Every answer to the prompt keeps a way to add a photo, tested
- Metadata tests read real bytes with controls that carry a location
