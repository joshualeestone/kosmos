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
1. web/index.html: `window.kosmosAppTab` beside burgerClose. Every path is a REAL PRESS, so it lands where a person's
   press lands and every click tidier on the page runs (header menus and pickers close on a click elsewhere; review 5
   showed a refusal on open menus left native tabs dead, and a direct showTab skipped the tidiers): agents/projects/
   tasks press their tab; settings presses the user menu's Your Profile (#userpop-go-you, the first section; it opens
   in place in the consolidated layout, userpopSettingsGo). The phone menu, which a press does not close, is closed
   first, focus back to its button. Refuses (false, nothing changed) a name it has no section for, a missing control,
   a page without #tabs, a board made inert by a full-screen step (first run, an update, a restart; the phone menu's
   `closest('[inert]')` test), and an open box with its backdrop up (confirmations, What's New; the keystroke guard's
   own backdrop test, since those boxes are not inert): a person could not press then either.
2. web.app-tab-6846.test.js: the press path per tab (mutant: showTab instead of the press goes red), Settings, refusals
   (including a missing button), and pins on what it relies on (the click handler resets before showTab; the three tab
   buttons exist; Settings is buttonless).

## Not in this part
- (b) the iOS five tabs, after #6845 merges (it adds the TabView this extends). The app's contract with this door:
  call `typeof window.kosmosAppTab === 'function' && window.kosmosAppTab('<name>')` after the page has loaded, and treat
  false, undefined or an evaluation error as "not opened" (the door is absent on a sign-in page, an error page, or an
  older board), never as opened.
- (c) hiding the board's own navigation inside the app, ruled by Mona Lisa on #6846 (comment 6321645120, frames in
  ~/work/workers/monalisa/ios-design-2026-10-19/tabbar-6846/png/): hide the tab strip, the burger and the KOSMOS+
  wordmark; keep a 44pt navy header with the computer switcher left and the user menu right. Only when the app says it
  has the native bar (older app builds still need the strip), so the app sets a class at document start. Its own PR,
  with a browser check.
- Tasks visibility follows the status poll's tasksTab (#3559), and per Mona Lisa the bar changes only at launch or on
  return to the front, never while on screen; that is the iOS side (b).

## Weakest premise
That opening a hidden Tasks button is right. Decided, not missed (review 2 raised it): the board hides Tasks until a
status poll says tasksTab (localStorage restores it at boot when it can), so on a fresh page the button can be hidden
for an earned tab. The app offers Tasks only from the same engine flag, read by its own poll, so it is not staler than
the page's. Refusing would make an earned Tasks tab a silent no-op on every fresh page; accepting is wrong only if
the app shows Tasks from a stale flag, which the app side (b) must not do (it reads tasksTab only from a fresh poll,
and per Mona Lisa changes the bar only at launch or return to the front). What would change this: the engine ever
turning tasksTab back off (#3559 says once shown it stays).

## Validation
No visual change, so no browser check. The test drives the door's real code against fakes and pins, by text, the
board code it relies on (the press resets before showTab; the backdrop and open-menu tests; how the user menu opens
Settings). Where the board lands after the press is the press's own behaviour, already covered by the board's tests;
the consolidated layout's press (consNavClick) is never reached from a phone-width web view. A real-DOM check of the
door is a follow-up for part (c), whose browser check boots the board in the app mode anyway.
Boot: a call between load and the first-run answer can succeed and then be covered by first run's opaque overlay;
harmless (the section is simply behind it). The app calls after the page has finished loading. Focused run: every web.*.test.js plus fixture-discipline, no-brand-refs and
no-name-refs.
