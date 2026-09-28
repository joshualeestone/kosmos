# selfrelaunch-4347: after an update, the window restarts itself onto the new version, no dialog (kosmos#4347)

Josh (09:23): the "Kosmos updated while this window was open" dialog shows on every update, recommends the grey
button, and sits on top of What's New. Then (09:25): it takes 1 to 2 relaunches before it stops. Pass condition:
ONE update, the window ends on the new version, no second prompt; measure the relaunch count.

## Why it takes more than one relaunch (read from origin/main)
- /api/status's version is package.json read once at board start (server.js:217).
- The in-app update runs setup.sh: kosmos stop (marker) -> files swapped (2825) -> make_app rebuilds the app
  (3179-3221) -> kosmos start (3708). On paper the app is rebuilt before the new board answers.
- The check runs on every main-frame load (main.swift ~2727). While the board is paused mid-update the page
  fails; a reload of the dead page runs loadBoard -> `kosmos start` (main.swift ~1557), which clears the stop
  marker and starts the NEW files before make_app has rebuilt the app. The next page load offers a relaunch;
  relaunch reopens the path, whose bundle is still OLD; the replacement is behind again.
- Weakest premise: this is inferred from code, not measured on Josh's Mac (his app log lives in /tmp and has no
  timestamps). The fix below does not depend on which path made the bundle late: it waits for the bundle.

## What changes
1. **Wait for the bundle.** Before relaunching, read each candidate's Contents/Info.plist FROM DISK
   (NSDictionary(contentsOf:), never the cached Bundle(url:)) and relaunch only once one carries `theirs`.
   Candidates: /Applications, ~/Applications, and this process's own bundle path. Poll every 3 s, up to 180 s.
   None by then -> reopening cannot help -> the existing honest notice (showCannotSelfHeal), no loop.
2. **No question on the normal path.** Once a fresh bundle is there, ask the page whether a restart can lose
   anything (`kosmosSafeToRestart()`, the same test the page uses before reloading itself: nothing sending, no
   agent being created, no draft, no typed words, no file waiting, no dialog open). Yes -> relaunch silently.
   No -> ask again every 15 s; typing is never interrupted.
3. **Fallback prompt** only when the page cannot answer (an old page with no such function, a script error):
   "Restart Kosmos to finish updating. Your agents keep running." with **Restart Kosmos** as the blue default
   and Not Now. A relaunch that reopens itself is not a destructive quit, so Return may press it.
4. **Every relaunch logs a timestamped line** (ISO time, mine -> theirs, the target, seconds waited) so the
   count per update is measurable from the app log.
5. The #1182 loop bound stays: relaunchedAtVersion is written before relaunching, and a replacement that comes
   back at the same version gets the existing notice, never a second relaunch.

## Web
Split `updateSafeReload`'s "nothing to lose" test into `updateNothingToLose()` (unchanged conditions);
updateSafeReload keeps its own hidden-window and once-per-version guards and calls it.
`window.kosmosSafeToRestart = () => updateNothingToLose()`.

## Tests
- web.reload-toast.test.js: lift updateNothingToLose alongside updateSafeReload; a new test for
  kosmosSafeToRestart (true on a clean page; false with a draft, a typed box, a send in flight).
- main.swift stale selftest: pure `pickFresh` over on-disk versions (`onDiskVersion`) and the decision
  `relaunchStep(freshFound:waited:freshFor:page:toldGaveUp:askedBefore:seenFresh:)` -> wait / relaunchNow / askPerson / giveUp.

## Rejected
- Keep the dialog, restyle it (option B) as the main path: Josh's first complaint is that it appears at all.
- Stop loadBoard from starting the board mid-update: waiting for the bundle already makes the early board
  harmless for this card, and changing start behaviour during an update is its own risk.

## Review iteration 2 (changes)
- The page's answer has four values: safe (restart now), would lose (wait), cannot tell (an old page, or the
  check threw: ask), and no reply (a JS error, the page mid-load: ask the page again; a page that never answers
  is treated like one holding words, so after 10 minutes the person is asked, once).
- Words left in a box no longer hold the window on the old version forever: after 10 minutes with the new app
  ready, the person is asked, and the dialog says unsent words would be lost. Restart stays the blue default
  (Josh's ask); Not Now answers to Escape.
- An app NEWER than the awaited version is accepted (the board can move on again during the wait).
- The "app did not update" notice is remembered per version (kosmos.relaunchGaveUpAt), so it shows once.

## First update after this ships
The update that INSTALLS this change is run by the old window code (old dialog, old fallback). The pass
condition (one update, no second prompt) is first observable on the update after that.

## Weakest premises
1. The cause of the extra relaunch is read from code, not measured on Josh's Mac.
2. The 180 s wait for the new app is read from setup.sh, not measured. After it, the person is told once
   (per version pair) and the window keeps looking quietly, so a late app still gets the silent restart.

## Review iteration 4 (changes)
- A page still loading answers "loading" (ask it again), never "unknown" (which asks the person).
- When words are waiting, no button answers to Return, so a Return meant for a message box cannot restart.
  Restart keeps Return (the blue default) only when the page cannot tell.
- A dialog or sheet of the app's own (Cmd-Q, a file picker) counts as "would lose": never restart under it.
- A test ties the function name the window asks for to the one the page defines.

## Review iterations 5 and 6 (changes)
- The person is asked at most once per window. After Not Now the window keeps watching and restarts with no
  question as soon as the page says nothing would be lost.
- While a dialog, sheet or file picker of the app's own is open, the window does nothing and looks again later,
  so no restart closes it and no second dialog lands on it.
- The ask says "anything unfinished in this window, such as words not sent yet", because What's New being open
  or a send in flight also hold the restart.
- Giving up needs the new app never to have been seen: one seen and briefly unreadable mid-swap is waited for
  (review iteration 7).

## Review iteration 8 (changes)
- The page has a fifth answer, "hold": nothing would be lost, but not now. It covers What's New deciding
  (whatsNewCheck records the version as seen when it opens, so a restart mid-decision would lose it) or
  open, and anything the person did in the last 30 s (so the window does not vanish under a click).
  The window waits through a hold for as long as it lasts and never asks about it.
- A page that never answers is treated like one holding words in the ask (no Return, the loss sentence).
- Accepted: in stay-running mode with the window hidden, a silent restart shows the window again, as the old
  dialog did.

## Review iteration 9 (changes)
- After the "did not update" notice only the silent restart remains; no second question for the same update.
- A silent restart that fails to open the new window is logged, not shown (nobody asked for it).
- A page error is logged once per window, then asked again.
- A What's New check pending longer than its own one-hour wait no longer holds the restart.

## Review iteration 10 (changes)
- The own-dialog check is made again when the window is about to act on the page's answer, so a Cmd-Q or file
  picker opened while the page was answering is never restarted under or covered.
- A silent restart that fails to open the new window is tried again quietly (the #1182 marker is cleared,
  since nothing reopened), up to 3 times this launch; after that the person is told once.

## Review iteration 12 (changes)
- Elapsed time is systemUptime (stops in sleep, like the poll timers), so a Mac that slept mid-update does not
  wake "past the limit" and show a false "did not update" notice.
- An exact version match anywhere is preferred over a newer copy (a shared Mac's other account).

## Status against the pass condition, stated honestly
Mechanism built and unit-tested (the pure decision, the plist read, the page contract). The behaviour (one
update, one relaunch, no second prompt) is NOT yet observed: that needs a real update from a build that
contains this change. Every relaunch writes a timestamped `relaunch:` line to the app log, so the count per
update can be read from there.
- Deliberate asymmetry: a failed silent restart is retried quietly (nobody saw it); a failed restart the
  person pressed is told at once and keeps the #1182 marker, as before this card (review iteration 13).
- With another app in front, the silent restart also waits for 30 s with no input anywhere on the Mac, so the
  new window never takes focus from what the person is typing elsewhere (review iteration 14).
- Kept, and re-raised by review: in the cannot-tell case Return presses Restart (Josh's blue default). That case
  is an old page, or a check that threw; when words are known to be waiting there is no Return key.
