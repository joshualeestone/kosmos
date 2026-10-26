# setuppolish-7205: setup polish from Josh's fresh install (kosmos#7205)

Owner: Mona Lisa. Routed by Splinter 2026-10-26 10:27, from Josh's notes in #admin (10:25 CDT). Design and copy.

## Done when
The six items below show on the real screens in light and dark, desktop and phone, with shots on the card before merge.

## What changes
1. Setup choice screen: the setup screens' dot field (#fr-dots) draws behind it too. frDots.host() moves the one fixed
   canvas into whichever setup screen is showing (the choice, then first run); its loop runs while either is up.
2. The two-computer drawings (Connect, and Run and connect): the dotted connector sat on the desktop's edge (its right
   dot reached x 322, the desktop starts at 320.5). Centred in the gap: 16 clear of each device, dashes centred.
3. The third option reads "Run agents on this computer and connect to agents on another computer" (the order was
   already Josh's).
4. Welcome has Back to the setup choice, only when that screen was shown in this load and first run was not opened by
   hand. Back closes first run, shows the choice again, and the new answer carries on as the first did. The Mac app
   ignored a second answer before (computerMode set after the first), so it now takes one in the same launch unless
   this computer has switched to connect (native-app/main.swift pageChoseMode, modeAskedThisLaunch). Josh's
   2026-08-17 "no Back" still holds for every step after Welcome; the comment says so.
5. The Qwen mark on the model picker is one colour (currentColor), black on light like the others (Josh asked; the
   brand-colour comment updated).
6. Help make Kosmos better, the Community switch: Josh's words verbatim.

## Weakest premise
That a person going Back after choosing Run and then choosing Connect is safe on the Mac: the app's connect path stops
the board it started for Run, which is the path a first-time Connect already takes from a running board.

## Checks
- render-firstrun-choice-4356.js C11: the dot field draws on the choice screen and moves back to first run; Welcome's
  Back; the choice shown again; the second answer posted ("run","both"); CONTROL: no Back without the choice. Without
  the dots call it goes red. All 50 checks pass (after round 1); render-firstrun-s6-2037.js passes with Josh's copy.
- web.firstrun-choice-4356.test.js and web.firstrun-consent-prc2.test.js pin the new words. Root web.* and native-app
  tests 3551/3551 (after round 1); swiftc -typecheck clean.

## Review
- Round 1 (findings in full: .claude/plans/setuppolish-7205-review1.md): 2 blockers, 2 warnings, 6 nits. FIXED 11:15 (see Round 1 fixes below);
  as found:
  - [BLOCKER] Run, Back, Both loses ?mode=both (frChoiceForget returns early once ?mode is gone), so first run does not
    end at the Kosmos Plus sign-in. Fix: write mode=both even when ?mode is gone (or a page flag frPlusLast reads);
    add a C11 assertion that first run ends at the sign-in.
  - [BLOCKER] #2518 surface gate: render-layer-gutter-4494.js (firstrun) and render-win32-board-copy.js
    (data-win-hide) need Browser-check-surface trailers; both pass on this branch (reviewer ran them).
  - [WARNING] Run, Back, Connect overlaps the first answer's kosmos start (switchToConnect does not bump
    boardStartGeneration): bump it in switchToConnect, as the reclaim path guards.
  - [WARNING] tools/windows/KosmosLauncher.cs:4463 ignores a second answer; offer Back only on the Mac bridge (or teach
    the Windows twin), FirstRunChoice is off there today.
  - Nits: frDots.boot() where the restart screen hands the choice back (~25279); focus after Back (focus the choice's
    heading or first button); Reload after Run then Back (accepted: no Back then); pageChoseMode doc comment now false;
    connector dash pair 0.25 px off centre; the win32 Qwen grayscale rule is redundant.

- Round 1 fixes (11:15):
  - BLOCKER both: frChoiceForget writes ?mode=both even when ?mode is gone. C11 now asserts the address says both
    and first run ends at the Kosmos Plus sign-in; perturbed back to the old line, both assertions go red.
  - BLOCKER gate: render-layer-gutter-4494.js (13 passed) and render-win32-board-copy.js (180/180) run and pass;
    Browser-check-surface trailers on the fix commit.
  - WARNING Connect race: ensureBoardRunning's completion undoes a start that lands after Connect, as
    reclaimStuckBoard does (reasoned from source, not measured: no harness drives the Mac app's start timing).
  - WARNING Windows: Back only on the Mac bridge (frBackOffered). C11 control: the WebView2 bridge shows the choice
    and Welcome offers no Back.
  - Nits taken: frDots.boot when the restart screen gives the choice back; Back focuses the first choice button
    (C11 asserts it); pageChoseMode doc comment; Reload-after-Back noted beside frBackOffered.
  - Nits left: connector dash pair 0.25 px off centre (cosmetic), win32 grayscale on the Qwen mark (harmless).
  - Evidence: root unit set 3551/3551; swiftc -typecheck rc 0; render-firstrun-choice-4356.js 50 passed (3 runs).
- Round 2 (.claude/plans/setuppolish-7205-review2.md): 0 blockers, 1 warning, 4 nits, all four round-1 fixes hold.
  Fixed: setup-welcome-back-7205 stands in the Mac bridge (Back needs it now); frChoiceForget's catch comment;
  switchToConnect clears modeAskedThisLaunch so the doc line is exactly true; the plan's counts; the win32 trailer's
  reason restated correctly on the round-2 commit.
- Round 3 (.claude/plans/setuppolish-7205-review3.md): 0 blockers, 1 warning, 1 nit. Fixed: native-app.computer-mode-4356
  now pins the guard's whole condition, the switchToConnect clear (and that it is the only other set), and
  ensureBoardRunning's late-start undo before the generation check; the reviewer's four mutations (M1 guard true, M2 no
  clear, M3 no undo, M4 connect allowed) each fail it, the unmutated file passes. The Connect save-failure alert says
  "it still runs agents on this computer" when run or both is already saved (Run, Back, Connect, a failed write).
