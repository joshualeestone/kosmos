---
pre_challenge: true
method: challenge-loop
branch: webfollow-8966
diff_hash: 8af0e03f46007d1e6bd0c1908f24377870618e34c8fddc3601b02774a426286f
validation: failed (load flakes, not this branch; see Validation below)
subdir_audit: passed
timestamp: 2026-11-24T12:50:40Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind review rounds (Opus and Sonnet alternating).
**Converged:** Yes. Rounds 5 and 6 raised no BLOCKER and no WARNING; round 6's two NITs were one applied, one declined with reasons.
**Total actionable findings:** 0 BLOCKERs, 8 WARNINGs, 2 CONVENTIONs, plus NITs
**Fixed:** all WARNINGs and CONVENTIONs | **Declined:** 1 NIT (round 6, reasoned below) | **Deferred to the card:** item 2 (device) | **Asked:** 0

## Validation
- 6j run 1 (f8ccae71b7, rebased on origin/main aa24bd6f47): 30911 tests, 1 failure: "#5516 review 11: link cycles end quickly"
  (a wall-clock assertion, "the walk took 3036 ms"). engine/launchpath-5516.test.js alone: 35/35, twice.
- 6j run 2 (same HEAD): 30911 tests, 1 failure, a different test: "antigravity: token reaches the provider but never tmux
  argv or logs" (20.5 s, a wait under load). supervisor.agent-token-argv-4497.test.js alone: 11/11, twice.
- The runs failed on different tests. This branch changes 0 files outside ios/ and .claude/plans/ (measured with
  git diff --name-only origin/main...HEAD). Judged load flakes; not proven. CI's node suite is the next witness.
- iOS on the rebased HEAD f8ccae71b7: ios/LogicTests/run.sh PASS 2270/2270, every run-*.sh PASS; WebFileUITests passed on the iOS 27 simulator after every round (36 to 47 s).
- Mutation control: WebPageState.processEnded without its `started = false` fails "the reload is let through, once" (FAIL 1 of 2270); restored, passes.
- Subdir audit: rc 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, NITs
- [WARNING] WebFileView: failure path untested, page-process termination unhandled --> FIXED (isDeliberateCancel, termination routed)
- [WARNING] cancel guard covers less than the plan said; SVG half had no after-check --> FIXED (svg.exists after the tap)
- [WARNING] savedName still read the raw type --> FIXED (bareType in savedName, fileWord, isPreviewableImage, fileAnswerAccepted)
- [CONVENTION] bareType sat between isWebDocument and its doc comment --> FIXED (moved above)
- [NIT] stale LockedWebView header, domain-less code check, a control that could not fail --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 1 (";text/html" loosened the fetch gate, introduced in iteration 1)
- [WARNING] a stray late error could wipe a drawn page --> FIXED (no error counts after didFinish)
- [WARNING] process termination after the viewer closed --> DECLINED (harmless: writes state on a gone view)
- [NIT] ";text/html" now accepted by fileAnswerAccepted --> FIXED (reads as text/html again, pinned through fileAnswerAccepted)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, NITs
- [WARNING] a background page-process kill showed a false can't-show card --> FIXED (draw again)
- [WARNING] the coordinator wiring had no failing test --> FIXED (pure Board decisions, logic-tested)
- [CONVENTION] plan contradicted the code (savedName, the control) --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 1 (the once-per-sheet redraw budget, introduced in iteration 3)
- [WARNING] a second background kill showed the card --> FIXED (redraw each time, capped at 3)
- [WARNING] flag resets untested --> FIXED (Board.WebPageState, stepped by logic tests; mutation control fails)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs
- [NIT] ";;;text/html" accepted by the fetch gate --> FIXED (bareType drops any leading ';')
- [NIT] isDeliberateCancel's comment paired codes with the wrong causes --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs
- [NIT] a redrawn page could take touches until didFinish --> FIXED (untappable before the reload)
- [NIT] svg.exists after the tap cannot fail --> DECLINED: the can't-show card replaces the webfile.page web view, so the element is gone and the check fails (round 2's reviewer read it the same way)

## Residuals (named, not fixed)
- No test drives WebKit itself: that the content rule applies to a restarted page process, and that NSURLErrorCancelled and WebKit 102 are the only codes a refused navigation reports before the first draw. Weakest premise, stated in the plan.
- Item 2 (Content-Disposition over the relay path) needs a phone: parked needs-device on the card after merge.
