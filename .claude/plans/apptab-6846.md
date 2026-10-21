# apptab-6846: the board's door for the iPhone app's native tabs (#6846, part a)

## Finished looks like
The board page publishes `window.kosmosAppTab(name)`. The iPhone app calls it from its native tab bar (Today, Projects,
Tasks, Settings; Agents is native) to open that section in its one web view without a reload, landing exactly where a
person's press on the board's own tab lands: at the top of the section. It answers true when it opened the section and
false for any name it has no section for, so the app never shows the wrong page silently.

## Why a door and not showTab
The `#tabs` click handler does more than showTab: consNavClick (walking away from a creation in flight), topLevelReset
(Josh: a top-level tab goes to the top, not back into the last project), and clearing the rail's lit project. showTab
alone restores the last open project, which is right for its programmatic callers and wrong for a tab press. The phone
menu (#pnav) already opens tabs by clicking the real tab and Settings by showTab + settingsOpen; this door does the same.

## Steps
1. web/index.html: `window.kosmosAppTab` beside burgerClose; closes the phone menu first; agents/projects/tasks press
   the real tab; settings opens showTab('settings') + settingsOpen('you'); anything else answers false.
2. web.app-tab-6846.test.js: the press path per tab (mutant: showTab instead of the press goes red), Settings, refusals
   (including a missing button), and pins on what it relies on (the click handler resets before showTab; the three tab
   buttons exist; Settings is buttonless).

## Not in this part
- (b) the iOS five tabs, after #6845 merges (it adds the TabView this extends).
- (c) hiding the board's own navigation inside the app, ruled by Mona Lisa on #6846 (comment 6321645120, frames in
  ~/work/workers/monalisa/ios-design-2026-10-19/tabbar-6846/png/): hide the tab strip, the burger and the KOSMOS+
  wordmark; keep a 44pt navy header with the computer switcher left and the user menu right. Only when the app says it
  has the native bar (older app builds still need the strip), so the app sets a class at document start. Its own PR,
  with a browser check.
- Tasks visibility follows the status poll's tasksTab (#3559), and per Mona Lisa the bar changes only at launch or on
  return to the front, never while on screen; that is the iOS side (b).

## Weakest premise
That a synthetic click on a hidden Tasks button behaves like a press. It does in the browser (click() dispatches
regardless of visibility), and the app only offers Tasks when tasksTab is true, at which point the button is shown.

## Validation
No visual change, so no browser check. Focused run: every web.*.test.js plus fixture-discipline, no-brand-refs and
no-name-refs.
