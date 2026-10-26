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
  the dots call it goes red. All 45 checks pass; render-firstrun-s6-2037.js passes with Josh's copy.
- web.firstrun-choice-4356.test.js and web.firstrun-consent-prc2.test.js pin the new words. Root web.* and native-app
  tests 3449/3449; swiftc -typecheck clean.

## Review
- Round 1 (findings in full: .claude/plans/setuppolish-7205-review1.md): 2 blockers, 2 warnings, 6 nits. NOT YET FIXED
  (session restart for account usage, 10:55):
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
