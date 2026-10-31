# Challenge round 2: setuppolish-7205 (head 31cf509801), blind CTO lens

Scope: the whole branch diff against origin/main, with extra attention on the round 1 fix commit 31cf509801.
Each claim is marked MEASURED (I ran it on this head) or REASONED (read from source, not run).

## Round 1 findings: does each fix hold?

- [BLOCKER] Run, Back, Both loses ?mode=both: HOLDS. MEASURED: render-firstrun-choice-4356.js C11 passes (50 passed,
  exit 0), including "the address says both again" and "first run ends at the Kosmos Plus sign-in". My own probe of the
  reverse order (Both, Back, Run) shows ?mode removed and frPlusLast() false after the second answer, so the fix did not
  make "both" sticky. frChoiceForget has one caller (frChoose's onclick, web/index.html ~89017), so the widened write
  cannot fire from anywhere else (REASONED, grep).
- [BLOCKER] #2518 surface gate: HOLDS. MEASURED: kosmos_browser_check_surface_gate exit 0 (both overrides read from the
  trailers), kosmos_browser_check_gate exit 0. render-layer-gutter-4494.js 13 passed, render-win32-board-copy.js
  180/180. One trailer's reason text is wrong, see the NIT below.
- [WARNING] Connect races the first answer's start: HOLDS for the case named. REASONED: ensureBoardRunning's completion
  now undoes a start that lands after switchToConnect, before the generation guard, in the same shape as
  reclaimStuckBoard and loadBoard's #4356 block. Its stop is counted in stopsInFlight, so Run agents is held while it
  runs. A stale completion on a connect computer now bumps the generation and clears boardStartInFlight; no newer start
  can be in flight while computerMode is connect (runAgentsHere sets .run before loadBoard), so that clear is safe.
  Not measured: no harness drives the Mac app's start timing.
- [WARNING] Windows ignores a second answer: HOLDS. MEASURED: C11's WebView2 arm shows the choice and Welcome offers no
  Back. REASONED: only main.swift and KosmosLauncher.cs register kosmosMode, so the Mac check in frBackOffered covers
  every host.
- Nits taken (dots after the restart screen, focus after Back, pageChoseMode doc, Reload note): present. MEASURED: Back
  focuses the first choice button (C11 and my probe: activeElement BUTTON). Reload during the second choice opens
  Welcome without Back, as the new comment says (probe D).

## New findings

[WARNING] docs/browser-checks/mobile-shots.js:1586-1591 (screen `setup-welcome-back-7205`): the round 1 fix broke the
card's own design-shot screen. MEASURED. The screen sets FR_CHOSE_HERE = true and waits for `#fr-alt:not([hidden])`,
but since 31cf509801 Back also needs the Mac bridge (frBackOffered checks window.webkit.messageHandlers.kosmosMode),
and this screen stands in no bridge. Running
`mobile-shots.js --screens setup-welcome-back-7205,setup-choice-7205` on this head: 16 of 16 welcome-back shots
"ERROR page.waitForSelector: Timeout 5000ms exceeded", exit 2; the setup-choice shots are fine.
Scenario: the card says "Design shots on the card before merge". The shots posted there are from cece6a053d, before the
fix; anyone re-taking them for this head (or a later design review via /design-shots) gets no Welcome-with-Back shot
and a red run. CI does not run mobile-shots (grep of tools/run-tests.sh and .github/workflows: no hits), so nothing
else will catch it.
Fix: in that screen's go, stand in the bridge before loading, as setup-choice-7205 does:
`await page.addInitScript(() => { window.webkit = { messageHandlers: { kosmosMode: { postMessage() {} }, kosmosBadge: { postMessage() {} } } }; });`
then re-run the screen and confirm 16 ok.

[NIT] Commit 31cf509801 trailer `Browser-check-surface: render-win32-board-copy.js data-win-hide on the choice screen`:
the reason is factually wrong. MEASURED: the only changed lines carrying `data-win-hide` are the Qwen row in first
run's Model step (diff lines 44-45 of web/index.html), not the choice screen. The gate only needs the basename, so it
passes, but the trailer is the permanent record of why the check was waived. Fix: if the branch is rebased or amended
anyway, say "data-win-hide on the Qwen row (its mark now currentColor)".

[NIT] web/index.html ~88969, frChoiceForget's catch comment: "the address keeps ?mode=; the app still ignores a second
choice". On the Mac app a second choice in the same launch is now taken (pageChoseMode, modeAskedThisLaunch), so the
comment is stale. REASONED. Fix: drop the second clause, or say "a Reload may ask again".

[NIT] native-app/main.swift ~2964 doc comment and ~2973 guard: "until this computer switches to connect" is not quite
what the guard does. After Connect, the menu's Run agents on this computer sets computerMode = .run, and
modeAskedThisLaunch is still true, so pageChoseMode would take a page answer again. REASONED. Not reachable from the
page today (withModeQuery puts no ?mode on a run computer, so no choice screen can post), hence a nit. Fix: clear
modeAskedThisLaunch in switchToConnect, which makes the comment exactly true.

[NIT] .claude/plans/setuppolish-7205.md "Checks" section still says "All 45 checks pass" and "Root web.* and native-app
tests 3449/3449"; the round 1 fixes section says 50 and 3551. MEASURED (read). Fix: update the Checks line so the plan
states one current count.

## Checked and found clean

- MEASURED: root unit set (web.*.test.js, native-app*.test.js, browser-checks*.test.js, fixture-discipline,
  no-name-refs) with the dot reporter: exit 0, 3551 passes counted, 0 failures.
- MEASURED: `swiftc -typecheck native-app/main.swift` (DEVELOPER_DIR=CommandLineTools): exit 0, 0 errors.
- MEASURED: render-firstrun-choice-4356.js exit 0, "all first-screen checks passed (50)". render-firstrun-s6-2037.js
  exit 0, label exactly Josh's line. render-layer-gutter-4494.js exit 0, 13 passed. render-win32-board-copy.js exit 0,
  180/180.
- MEASURED: kosmos_browser_check_surface_gate exit 0 and kosmos_browser_check_gate exit 0 on this head.
- MEASURED with a scratch Playwright probe on the real board (Mac bridge stood in), no page errors:
  - Both, Back, Run: address loses ?mode, frPlusLast false, posted ["both","run"].
  - Back twice in a row: posted ["both","run","run"], Welcome offers Back each time, the dot field follows.
  - Get Started after Back: the next step's left action is "Skip connecting a model", not Back, so no step after
    Welcome goes back.
  - Run, Back, Connect: posted ["run","connect"], the three buttons disabled, first run hidden and inert, as a
    first-time Connect behaves (focus lands on body because the focused button was disabled; same as main's
    first-time Connect, not new).
  - Reload during the second choice: Welcome without Back, nothing posted, matching the accepted note.
- MEASURED: setup-choice-7205 design shots, 16 ok, 0 overflow (the 5 small tap targets are the existing controls).
- REASONED: frClose does not write first-run state (no fetch in it), so Back from Welcome cannot mark first run seen.
- REASONED: Josh's copy is verbatim for items 3 and 6 (the markup, both unit tests and the s6 check agree).
- MEASURED: no em dashes in added lines of the diff (0; control: 283 in web/index.html).

0 blockers, 1 warning, 4 nits.
