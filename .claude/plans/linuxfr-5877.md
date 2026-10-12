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
- The scan line "Could not scan Documents, Downloads, or Desktop this time" stays on Linux, unchanged (review 5). In
  review 2 I hid it on Linux as a macOS-permission line; review 5 showed it names no permission and is TRUE on Linux
  (those folders are not scanned there, #5882), so hiding it made the import list look complete when it is not. I
  reverted that, and the review-4 helper with it. My review-4 claim that pane 9 could go empty on Linux was also wrong:
  frPaintFleet returns after the "Setup complete" paint, so the adopt arm and frPaintScan are not reached today. #5882
  is the real fix (scan those folders on Linux), and once it lands the line stops appearing there on its own.
- Deep links: 2, 3, 4 land on Model (5) and 7 on About you (8), by number.
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
