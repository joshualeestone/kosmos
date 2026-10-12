# kosmos#5865: the rest of the Mac-only steps that reach a Linux (or Windows) board

## Finished looks like
A Linux board, at the computer or seen remotely through Kosmos+, never tells the person about "your Mac", the Dock,
or an app icon; a Windows board's slow world-switch line names the Windows step, not "quit and reopen". Each fix is
pinned by a test that runs the real page function with the platform set, and a Mac control is unchanged.

## Re-measured on main (5bfc177fc), not the card's line numbers
1. Remote view (Kosmos+ / LAN / proxy) of a Linux board: `paintOfflineNote` says "Your Mac is not answering" +
   MAC_ASLEEP_SENTENCE; the device-offline note, OFFLINE_SENTENCE, SIGNED_OUT_SENTENCE, ORG_SIGNED_OUT_SENTENCE and
   the signed-out line at ~36250 all say "your Mac". (The card named only the first; the same words are the class.)
2. Settings, Computer, "Opening Kosmos": "Kosmos is already in your Dock..." with the icon image; Windows has its own
   copy (data-win-copy), Linux gets the Mac's.
3. Settings, "App icon" (Dock badge switch): hidden on Windows only; a Linux board has no app icon.
4. Daily report setting, unreadable: "Open Kosmos from its icon and you can change it."
5. worldswStuckStep: Windows gets "quit and reopen Kosmos" (#5862 gave Linux its own step only).

## Decisions
- One word for the machine on Linux: "the computer running Kosmos" (a headless server has no other name we know).
  Chosen once at load from the served platform meta (it is in <head> before the script runs), so the existing
  constants keep their names and the `t === OFFLINE_SENTENCE` comparisons keep working.
- Linux asleep sentence: a server is not "asleep"; it says the computer may be off or Kosmos stopped, and the step is
  `kosmos restart` on it (the same step #5862 uses).
- A `data-linux-hide` / `data-linux-copy` pair, the Windows mechanism's twin, stamped by applyPlatformCopy.
- Windows world-switch stuck step: the existing restartKosmos sentence (worldSwitchRestart already uses it).
- NOT in this card: first run on Linux. engine/firstrun.js has no Linux case and a fresh Linux install has no
  first-run.json, so a Linux board walks the whole Mac-shaped wizard (Dock, background-activity notice, sleep). That
  is far more than the one success line the card lists; filed as #5877 with the measurement.

## Weakest premise
That a remote Linux board's offline state is reached the same way as a Mac's (offlineRemoteView is !onWindows() &&
kplusRemote(), so yes by code; not walked on a real Linux board).

## Tests
web.win32-board-copy.test.js pattern (platform set via the served meta stub) for each arm + Mac control. Kitty's
warning: web.engine-restart-screen-4408 and web.firstrun-choice-4356 lift functions with hand-written stub lists;
run every web*.test.js from the worktree as cwd.

## Review 1 (blind, opus) changed the scope
- Settings "Opening Kosmos" also paints the engine's app-location row; engine/machine.js appLocationCheck has no Linux
  arm, so on Linux it warned "We could not find the Kosmos icon". Hidden on Linux with its reveal button and message.
- The Accessibility line and button and the tmux permission box (macOS TCC) are hidden on Linux too.
- A Linux arm in docs/browser-checks/render-win32-board-copy.js checks the hiding by computed style in chromium and
  webkit, with a Mac control; the unit test counts every data-linux-hide element against a named list.

## Review 2 (blind, sonnet)
- hostMachine/HostMachine gained a Windows arm ("your PC"): the signed-out sentences said "Your Mac" on a Windows board
  seen from a phone.
- Audited every data-win-hide element for Linux: Open Terminal is hidden (engine/terminal.js drives Terminal.app via
  osascript); Update Kosmos automatically STAYS (a Linux install has runtime/bin/node, so engine/update.js
  installedRoot finds it); the first-run ones (S3 mocks and gate, S7 Dock drawing) are #5877's.

## Review 3 (blind, opus)
- Hidden on Linux: the agent Files "Open in Finder" and the project docs "Open this folder in Finder" (revealFolder
  runs /usr/bin/open). The agent page's Terminal box takes Windows' title and Trust & Restart hint (no "macOS").
- The Linux not-answering sentence covers both causes it names ("Make sure it is on, then run kosmos restart").
- platformHides knows data-linux-hide, so a first-run gate #5877 hides on Linux is not waited on.
- HostMachine renamed hostMachineCap (a case-only difference was easy to mistype).

## Review 4 (blind, sonnet)
- The Files overflow line no longer says "Open in Finder shows them all" on Linux, and the file preview offers
  Download on Linux (as it does through Kosmos+) instead of a reveal that runs /usr/bin/open.
- MAC_ASLEEP_SENTENCE's Mac arm names the machine through hostMachine(); the Windows test loop covers all four sentences.

## Review 5 (blind, opus)
- The same revealFolder route is behind project Settings' "Show me where it is" and "Show me where the conversations
  live" and the task page's "Show me where the task conversations live": hidden on Linux with their hints.
- The agent's Terminal section is named "Start-up and restart" on Linux (data-linux-aria-label, applied by
  applyPlatformCopy), matching its heading; browser-checked with a Mac control.

## Review 6 (blind, sonnet)
- Settings > Computer's machine rows come from engine/machine.js, which has no Linux arm (pmset sleep, Kosmos.app
  location, macOS pane URLs). DEFERRED to #5877 (comment 6115721162): an engine change, and first run reads the same
  sleepGate, so it is decided with that card.
- The browser check covers every data-linux-hide element now; the sentence block says it needs PLATFORM_COPY_FNS.
