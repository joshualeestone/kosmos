# linuxfr-5877: first run on a Linux board walks only what a Linux board can do

Card #5877 (found by Angel while building #5865).

## The decision (the card's item 1)
A Linux board gets first run, a shorter one: Welcome, Model, Help make Kosmos better, About you, Your agents (panes
1, 5, 6, 8, 9). A person reaching a server in a browser still has to pick a model and add an agent, and none of those
five screens is about a desktop Mac.

Skipped on Linux, each for a reason that would hurt there:
- 2 Access (macOS folder-permission dialog) and 3 Automation (Accessibility and sleep grants): both keep Next greyed
  until the grant, and a Linux board can never grant them, so the person would be stuck on step 3 for good.
- 4 Notifications: a macOS "App Background Activity" banner that Linux never shows.
- 7 Success: the Dock drawing and "Kosmos is now in your Applications folder".

Rejected: no first run at all on Linux (the person still needs a model and an agent, and the wizard is where they get
them); Linux copy for steps 3 and 7 (a server has no sleep setting to show and no Dock; a screen with nothing true to
say is better gone).

## Done when
- frStepSequence on a Linux board is [1, 5, 6, 8, 9]; every Next hop and a deep link to a skipped step land inside it;
  progress counts only those steps. Mac and Windows are unchanged (controls).
- The five kept panes, read as the person sees them, name no Mac thing (Dock, Applications folder, Finder, macOS,
  "this Mac", System Settings, Keychain, sleep); a control proves the reader finds them in panes 3 and 7.
- web.firstrun-linux-5877.test.js fails on main's page (3 of 5; the 2 controls pass there by design).

## Not in this change
- The card's item 3, walking it on a real Linux board (the #4916 box). That needs the Linux board; the card stays open
  for it after merge, parked needs-device.
- The gate poll (frPollGates) reads only the shown screen's gates, so skipped gated screens are never polled.

## Weakest premise
That every Linux board is a server reached in a browser. A Linux desktop with a dock would lose a Success screen it
could use. No Linux desktop build exists today; if one comes, step 7 gets Linux copy then.

## Browser check
The step list is the page's own frStepSequence, run with the served platform set, plus the kept panes' served text.
Covered by web.firstrun-linux-5877.test.js; trailer used.
