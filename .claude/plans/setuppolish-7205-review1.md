# Challenge round 1: setuppolish-7205 (head cece6a053d), blind CTO lens

## Findings

[BLOCKER] web/index.html (frChoiceForget, ~88948) with frBackToChoice (~87038): the "both" path loses its last step when the first answer was Run.
frChoiceForget('run') deletes ?mode from the address. After Back, frChoiceForget('both') hits `if (!u.searchParams.has('mode')) return;` and never writes ?mode=both. frPlusLast() reads `?mode` and gets null, so first run ends on the ordinary ending, with no Kosmos Plus sign-in. The Mac app has `.both` written (pageChoseMode), but the page does not show the sign-in Josh ruled is the LAST step.
Repro (frChoiceForget body extracted from the file and run in node, href starting at `/?mode=unset`): after run `http://127.0.0.1:16180/`; after both still `http://127.0.0.1:16180/`, and frPlusLast's mode is null.
Scenario: Run, then Welcome, then Back, then "Run agents on this computer and connect...", then finish first run: no Kosmos Plus sign-in in this launch. The next launch has first run done, so the sign-in never comes. render-firstrun-choice-4356.js C11 checks this exact order (run, then both) but only checks `posted`, never frPlusLast or the address, so it passes.
Fix: for 'both', write ?mode=both even when the address no longer has ?mode (frChoiceWanted already passed in this load), or keep a page flag that frPlusLast also reads. Add a C11 assertion on the end of first run (as C10 does).

[BLOCKER] CI gate #2518: the surface gate is red, and tools/run-tests.sh:936 (run by .github/workflows/test.yml) runs it.
`kosmos_browser_check_surface_gate` gives exit 1:
  render-layer-gutter-4494.js  (surface token 'firstrun' changed in web/index.html)
  render-win32-board-copy.js   (surface token 'data-win-hide' changed in web/index.html)
No commit on the branch has a `Browser-check-surface:` trailer. Both checks pass on this branch (layer-gutter: 13 passed, no problems; win32-board-copy: 180/180). So the fix is a per-check `Browser-check-surface: <basename> <reason>` trailer for each, or a touch to each check. The coarse #1720 gate passes (exit 0), because docs/browser-checks files are already touched.

[WARNING] native-app/main.swift ensureBoardRunning (~2883-2908) with switchToConnect (~2985): Run, then Back, then Connect races the first answer's `kosmos start`.
The first answer (run) starts `startBoard` off the main thread. switchToConnect does not bump boardStartGeneration, so that start's completion is not suppressed. If the person goes Welcome, Back, Connect while `kosmos start` is still running, `kosmos stop` and `kosmos start` overlap. One of two things can then happen. (a) The start lands after the stop, which leaves a board running on a connect computer. (b) The start reports failure, which shows "Kosmos could not start its board on this computer after your choice..." over the Kosmos+ sign-in.
This could not happen before this change: Connect was never possible after a run answer in the same launch. The reclaim path at ~3343 already handles this class by name ("can finish AFTER the person switched this computer to connect... switchToConnect ... does NOT bump boardStartGeneration") and undoes the start. ensureBoardRunning has no such guard.
The plan's weakest premise ("the path a first-time Connect already takes") misses the start still in flight. This is reasoned from the source, not measured. Fix: give ensureBoardRunning's completion the same `computerMode == .connect` undo as the reclaim path, or have switchToConnect bump the generation and stop after.

[WARNING] tools/windows/KosmosLauncher.cs:4463 PageChoseMode still ignores a second answer, but the page offers Back on any bridge, WebView2 included.
frChoiceBridge returns the WebView2 bridge, and FR_CHOSE_HERE is set the same way there. Windows takes only an Unset or Unreadable mode. This is latent today because `FirstRunChoice = false` (KosmosLauncher.cs:1022) means no ?mode=, so no choice screen. Once that switch flips, two things break. Run, Back, Connect: the page sets FR_CHOICE_CONNECTING and disables all three buttons, the launcher drops the message, and the person is stuck on a dead choice screen. Run, Back, Both: the launcher silently stays on run.
Fix: offer Back only on the Mac bridge (window.webkit.messageHandlers.kosmosMode), or change the Windows twin to match. At least, note it beside the release switch so whoever flips it knows.

[NIT] web/index.html ~25279-25283: when the restart screen clears, it gives #fr-choice back (frc.hidden = false) without frDots.boot(). While the restart screen is up, both setup screens are hidden, so the dot loop stops (frame's condition). When the choice comes back, the field is frozen until first run opens. Decoration only. Fix: call `frDots.boot()` there (wrapped in try).

[NIT] Back's focus: frClose focuses FR_RETURN, which is the now-hidden choice button or body, and frChoose focuses nothing. A keyboard or screen-reader user who presses Back lands on body with no announcement. The first show has the same behaviour, but here the person has just acted. Fix: focus the first .frc-btn when shown by Back.

[NIT] Reload while the second choice is up, after a first Run: ?mode is gone, so the reload skips the choice and opens Welcome without Back. The app is on run. Nothing breaks, but the person who pressed Back meaning to pick Connect lands in run's first run. Probably acceptable; worth one line in the comment.

[NIT] native-app/main.swift ~2947: the doc comment above pageChoseMode still says "Heard only while no choice is saved ... once one is, no page can change it". With modeAskedThisLaunch, any later kosmosMode post in the same launch is now taken, even after first run has finished. The new block comment says why, but the doc line above it is now false.

[NIT] Connector geometry (both SVGs): the device clearance is symmetric and correct. With stroke-width 4 the laptop's outer edge is 236.5, the desktop's 318.5, and the dots are at 250.5..265.5 and 289.5..304.5, so 14 units clear each side, centred on 277.5. The dash pair is centred on 278, though, and its gaps are 4 / 5 / 3 units (butt caps). That is a 0.25 CSS px offset, so the plan's "dashes centred" is very slightly off. Cosmetic.

[NIT] web/index.html:12501: the win32 `grayscale(1) opacity(.8)` filter on the first-run Qwen mark is now redundant on a monochrome mark (harmless). ios/Kosmos/Assets.xcassets/MarkQwen.imageset/qwen.svg still fills #0a2cff. That is out of this card's scope (Josh named the web model picker), noted so nobody assumes every Qwen mark is black now.

## Checked and found clean
- Josh's copy is verbatim, character for character. Item 3: "Run agents on this computer and connect to agents on another computer". Item 6: "Let your agents join the Kosmos+ Community to help make Kosmos work better for you. None of your personal information is ever shared." The card's order (run, connect, both) matches the markup.
- No em dashes in added lines: 0 found, with a control showing 283 in the file.
- Unit set (web.*, native-app*, browser-checks*, fixture-discipline, no-name-refs-3071): 3551 pass, 0 fail, exit 0.
- Gates: #1720 kosmos_browser_check_gate exit 0. swiftc -typecheck exit 0 (only pre-existing deprecation and capture warnings).
- Browser checks: render-firstrun-choice-4356.js 45 checks passed, exit 0. render-firstrun-s6-2037.js OK, label exact.
- Back flow, inert: frClose un-inerts body children, then frChoose's frChoiceInert(true) re-holds them, #firstrun included, and gives back only its own. frOpen re-applies its own. FR_CHOICE_PENDING is set again by frChoose and cleared on answer. A restart screen during the second choice behaves as during the first.
- Escape during the second choice: the first-run Escape handler returns while #firstrun is hidden, and the choice screen has no Escape exit, as on its first show.
- Mac app, both then run: run writes and clears ?mode, so frPlusLast is correctly false. Run then both, or both then run: the mode is written again. ensureBoardRunning is skipped while a start is in flight (fine for run and both). modeAskedThisLaunch is set once, in readLaunchComputerMode, so it cannot be reset mid-launch.
- Dot field: the canvas is position:fixed, so moving it between parents does not move it. In #fr-choice it is the first child, and .frc-box (now position:relative) paints above it. The handoff from first run to the choice is synchronous (frClose, then frChoose's executor), so no rAF frame sees both hidden and the loop continues. boot() does not double-start while running. Reduced motion draws statically. Resize refits. When the choice is shown but first run does not open (state.done), the canvas stays in the hidden #fr-choice, the loop stops, and a later frOpen hosts it back. The dots are visible and very light on the light and dark choice shots.
- Qwen mark: first run stays light in both themes, so it is black there. Its clones in the provider comboboxes (providerMarkNode) now follow the text colour on the dark board, as OpenAI's does, so they stay visible.

2 blockers, 2 warnings, 6 nits.
