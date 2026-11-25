# firstrun-1125: the first-run screens in mobile-shots (Josh 11-25 07:51, "all the app initial screens")

Finished means: one command shoots every screen a new person sees on a computer, from the app's first window to the
first chat, on Mac and on Windows, numbered in order, with no personal data, and the existing screens and data sets
are unchanged.

## Built (docs/browser-checks/mobile-shots.js only)
- `--data fresh`: one agent, Dana, made a moment ago; no messages, files, project or question. seedFiles and seed()
  return early for it, before the chat files, the question and the projects.
- Screens fr-mac-01..14 (setup choice, panes 1-9, board, New agent, its role step, first chat) and fr-win-01..11
  (Windows hides panes 2 and 4). Windows: the board's document is routed and its kosmos-platform meta stamped win32,
  and every Windows screen asserts html[data-kosmos-platform="win32"].
- The board-showing screens carry needsData: 'fresh', so without it they are skipped (never the sample fleet under a
  first-run name). All carry noServiceWorker: true (they share frPrep, which can stub a route; #6206).

## Used for
~/work/design-shots/first-run-1125/ (mac 19, windows 13, with the site and installer pages shot separately), sent to
Josh by Splinter 08:07.

## Review round 1 (sonnet, blind): nothing above WARNING
- WARNING taken: the board screens without --data fresh photographed the sample fleet; now needsData: 'fresh'
  (checked: without it fr-mac-11-board is skipped, a pane still shoots).
- Then the repo's guards: #6022 (a route handler outside a try) and #6206 (the screens were built by a flatMap, which
  its structural count cannot see, and a stubbing screen must turn the service worker off). Rewritten as literal
  entries over helpers frPrep, frIsWin, frPane, frBoard, frChat; route handler in a try. All 110 tests that read the
  tool pass; fixture-discipline, no-name-refs, no-brand-refs pass. Reshot: board, new agent and chat screens
  pixel-identical to the delivered set; setup panes differ only in the animated dot field.

## Review round 2 (opus, blind, whole branch): nothing above WARNING
- WARNING taken: the Windows route fetched bare and, on failure, left the load hanging (under --remote, a 30 s
  timeout per shot): now fetchBoard, fallback on a failed fetch, abort on any other failure.
- WARNING answered: Windows has no setup-choice screen on purpose. The page supports it (frChoiceBridge,
  chrome.webview), but the Windows app's FirstRunChoice switch is off on main (tools/windows/README.md, "Off on main"),
  so a new Windows person starts at Welcome. Said in the code beside the screens.
- NITs taken: the whole fr- set needs --data fresh (skipped otherwise, and kept out of default sweeps); a Mac screen
  on a board stamped win32 or linux throws; frBoard refuses an unknown step; the usage line lists fresh.
