# linuxfr-5877: first run on a Linux board walks only what a Linux board can do

Card #5877 (found by Angel while building #5865).

## The decision (the card's item 1)
A Linux board gets first run, a shorter one: Welcome, Model, Help make Kosmos better, About you, Your agents (panes
1, 5, 6, 8, 9). A person reaching a server in a browser still has to pick a model and add an agent, and none of those
five screens is about a desktop Mac.

Skipped on Linux, each for a reason that would hurt there:
- 2 Access (macOS folder-permission dialog) and 3 Automation (Accessibility and sleep grants): permissions a server
  does not have. Corrected in review 3: they would NOT have trapped the person. The gates are fail-safe (an unreadable
  reading is advisory, engine/fileaccessstatus.js read(): checkable:false), so Next stays enabled; the rows would sit
  on "Checking..." then "Not activated" with a Turn On that opens nothing on a server. My first note said "stuck on
  step 3 for good"; that was wrong and is corrected here, in the code comment and on the card.
- 4 Notifications: a macOS "App Background Activity" banner that Linux never shows.
- 7 Success: the Dock drawing and "Kosmos is now in your Applications folder".

Rejected: no first run at all on Linux (the person still needs a model and an agent, and the wizard is where they get
them); Linux copy for steps 3 and 7 (a server has no sleep setting to show and no Dock; a screen with nothing true to
say is better gone).

## Done when
- frStepSequence on a Linux board is [1, 5, 6, 8, 9]; every Next hop and a deep link to a skipped step land inside it;
  progress counts only those steps. Mac and Windows are unchanged (controls).
- The five kept panes' served markup (each read to its own closing div, so pane 9 does not run into the Create
  panel) names no Mac thing (Dock, Applications folder, Finder, macOS, Mac, System Settings, Keychain, Spotlight,
  Launchpad, menu bar, sleep, in any case, and the app name "Terminal"); a control proves the reader finds them in panes
  3 and 7. Text painted at run time is not rendered by the test; the one Linux-specific painter arm, pane 5's sign-in
  hatch (#5449), is read from source and holds none. The other painters in the kept panes (frPaintYou, frPaintFleet)
  hold no Mac words in their painted text (frPaintYou, frPaintFleet; checked in reviews 1 and 2).
- Pane 9's scan list (frPaintScan) and the Create panel's (populateFoundImports) no longer say "Could not scan
  Documents, Downloads, or Desktop this time" on Linux (review 2): it is a macOS folder-permission result, and a Linux
  board reports those folders unavailable because the engine routes them to the macOS hatch. frPaintScan is painted for
  real in the test with a Mac control. The engine half (those folders are never scanned on Linux) is #5882.
- web.firstrun-linux-5877.test.js fails on main's page (the Linux sequence, deep-link and kept-pane tests; the controls
  and the pane-9 boundary and hatch checks pass there by design).

## Not in this change
- The card's item 3, walking it on a real Linux board (the #4916 box). That needs the Linux board; the card stays open
  for it after merge, parked needs-device.
- The gate poll (frPollGates) reads only the shown screen's gates, so skipped gated screens are never polled.
- A deep link to 2, 3 or 4 on Linux lands on Model (5), earlier in the display order: frStepAfter falls back by pane
  NUMBER, as it does on Windows. Only the screenshot deep link reaches it; every Next hop follows the sequence.
  Accepted (review 3).

## Weakest premise
That every Linux board is a server reached in a browser. A Linux desktop with a dock would lose a Success screen it
could use. No Linux desktop build exists today; if one comes, step 7 gets Linux copy then.

## Browser check
The step list is the page's own frStepSequence, run with the served platform set, plus the kept panes' served text.
Covered by web.firstrun-linux-5877.test.js; trailer used.
