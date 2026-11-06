---
pre_challenge: true
method: challenge-loop
branch: reopen-8118
diff_hash: 486d5b90f8799e4627b78d4080b736503b8523782a7936bf4632c057dcec5835
validation: local (every web*, native-app* and browser-checks* test file, the app selftest, the computers browser check in Chromium and WebKit, both browser-check gates); not run as the full yarn test
subdir_audit: passed
timestamp: 2026-11-06T19:53:23Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, plus a colleague's review of the switcher half (Angel, read at 27fd49b898)
**Converged:** Yes. Iteration 8 found only NITs, zero BLOCKER/WARNING/CONVENTION. It was also the last round under the 8-round cap.
**Total findings:** 0 BLOCKERs, 18 WARNINGs, 7 CONVENTIONs, about 35 NITs
**Fixed:** every WARNING and CONVENTION | **Deferred:** one NIT filed as #8125, and the rest kept with reasons in the plan | **Asked:** 0

kosmos#8118 (Josh: "If I quit or restart the app, it automatically kicks me back to my local agents instead of persisting ... to the agents I was looking at"). The Mac app keeps the host of the computer the window was on (never a ticket or token), and the quit decides what the next launch reopens. At launch, once this computer's own board has loaded, the page goes back there the way the switcher does. It stays home and says why when it cannot, and a click, key, scroll, touch, drop or input stays home at once.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0
- [WARNING] the kept host outlived a session spent at home --> FIXED (later redesigned in round 3), commit f166a91c38
- [WARNING] a slow list could pull the window away while the person worked --> FIXED (time limit, touch guard)
- [CONVENTION] plan and code disagreed --> FIXED

#### Iteration 2, plus Angel's review
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs (round 2); 2 WARNINGs, 2 NITs (Angel)
**Self-generated:** 3
- [WARNING] a reload while the reopen waits could ask twice --> FIXED (stale-answer guard)
- [WARNING] typing during the ticket wait --> FIXED (blur, more stay events)
- [CONVENTION] a state machine tested by source text --> FIXED (`reopenStep`, pure, selftest rows)
- [WARNING, Angel] 6 s was below the route's own worst case --> FIXED (30 s, OA_COMPUTERS_LIMIT_MS)
- [WARNING, Angel] a passing failure forgot the computer --> FIXED
- [NIT, Angel] the open rule was a second copy --> FIXED (`computersOpens`, `computersOlderSaid` shared)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3
- [WARNING] the stale-answer counter counted finished loads, not commits --> FIXED (`pageCommits`)
- [WARNING] an error retry had no time limit --> FIXED
- [WARNING] keep or forget depended on self-reloads the person never sees --> REDESIGNED: quit decides (`applicationWillTerminate`)
- [WARNING] 30 s of home with no sign, then a switch --> FIXED ("Going back to ..." toast at once)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2
- [WARNING] a quit at home forgot a computer the person never chose to leave (mid-reopen, update relaunch, asleep) --> FIXED (`reopenOutstanding`, `quitKeeps` with rows)
- [WARNING] a crashed page read as home at quit --> FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 5 NITs
**Self-generated:** 4
- [WARNING] choosing to stay was lost after a crash --> FIXED (touched forgets at once)
- [WARNING] a computer that stays off toasted every launch --> FIXED (misses counted, 3 in a row forget)
- [WARNING] a failed switch left a stale promise on screen --> FIXED ("Opening ...")
- [CONVENTION] a successful reopen never settled itself; the plan contradicted the code --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 4
- [WARNING] misses reset when a switch started, not when it landed --> FIXED (`reopenMissesAfter`)
- [WARNING] an offline laptop counted its own failures as misses --> FIXED (`.notChecked`)
- [WARNING] a bare modifier key counted as "stay" --> FIXED
- [CONVENTION] count and retry wiring tested by source text --> FIXED (pure, rows)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 6 NITs
**Self-generated:** 2
- [WARNING] the retry bound was checked when the answer came, so it never applied --> FIXED (checked at the second ask)
- [WARNING] a click to stay was not confirmed until the list answered --> FIXED (said at the click; the read is aborted)
- [CONVENTION] four places out of date about the answers --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 0
- [NIT] a switch that starts but never lands is never counted as a miss --> DEFERRED to #8125
- [NIT] the remaining six --> KEPT, with reasons in the plan

### After convergence (test only)
`docs/browser-checks/render-computers-4648.js` now runs the launch reopen in the real page in Chromium and WebKit: 140 passed. A mutant with the switch removed fails it in all four runs. This satisfies the #1720 gate with a real check rather than a trailer.

### Validation (honest scope)
On db6ac614ac (rebased onto main): 475 web, native-app and browser-checks test files, 3937/3937; app selftest 287/287 (swiftc at the macOS 13.5 floor); the browser check 140/140 in both engines; both browser-check gates rc 0. Not run: the full `yarn test` (shell suite), and the app on a real install, which is the card's proof.

### Weakest premise
That every normal way the app ends reaches applicationWillTerminate (Cmd-Q, the menu, the Dock, an update's relaunch). A force quit or crash skips it, and then the last host kept at a page load stands.
