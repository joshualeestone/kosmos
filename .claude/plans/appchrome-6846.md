# appchrome-6846: the board's header inside the iPhone app's native tab bar (#6846, part c)

Stacked on apptab-6846 (part a, PR #6848, window.kosmosAppTab). Part b (the iOS five tabs) sets the class this keys on.

## Finished looks like
When the iPhone app shows its native tab bar, the board in its web view no longer draws its own navigation: no tab
strip, no two-line menu button, no KOSMOS+ wordmark. In their place is a slim navy header, 44pt under the status bar,
16pt side padding, holding:
- left, the computer switcher, "<this computer's name> ▾" (15pt semibold), which opens the phone menu (#pnav) at its
  Switch Computers level;
- right, the person's avatar (32pt), which opens #pnav at its Settings level (Settings sections, Switch Computers,
  Appearance, Log out).
Everything below the header is the board as it is today. A board opened any other way (a browser, an older app build
without the native bar, the Mac itself) is unchanged.

Ruled by Mona Lisa on #6846 (comment 6321645120; frames ~/work/workers/monalisa/ios-design-2026-10-19/tabbar-6846/png/)
and her reply on the controls (both open #pnav at the right level; no desktop popovers).

## Decided
- **Who says the native bar is there: the app.** The app adds the class `kapptabs` to `<html>` at document start (a
  WKUserScript, part b). Rejected: detecting the app from the page (the bridge handlers exist in older builds that still
  need the strip) and a query flag (the board's address writer drops unknown parameters).
- **Scope: html.kremote.kapptabs at phone width** (the same media query as the #4823 phone header). kremote is set by
  kplusBar, so the app's board (always over Kosmos+) qualifies; a wide iPad window is out of the iPhone target.
- **One computer: the left is empty.** Josh on #6396: "If there is only 1 computer lets not show 'This computer' in the
  top left - it makes no sense"; the board shows the switcher only when COMPUTERS_OPENABLE (two or more). Mona Lisa
  drew the one-computer case as the name with no chevron; Josh's ruling wins, and she was told (12:3x).
- **Both controls open the existing phone menu**, never the desktop popovers (Mona Lisa agreed). Left: pnavOpen, then
  Settings, then Switch Computers (Back walks back up). Right: pnavOpen, then Settings.
- **Focus on close goes back to the control that opened the menu.** pnavClose(true) focused #kplus-menu, which is
  hidden in the app; it now refocuses the opener when that is laid out, else #kplus-menu as before. kosmosAppTab
  (part a) does the same.
- **Painted from the board's own facts**: THIS_COMPUTER_NAME and COMPUTERS_OPENABLE (worldswComputersSeen, after each
  computers answer) and youFaceHtml (paintRailMe), so the header cannot disagree with the rest of the board.

## Steps
1. web/index.html, kplusBar: add `#kapp-comp` (button: name + chevron) before the mark and `#kapp-me` (button: avatar)
   in .kplus-bar-end. Hidden unless html.kapptabs by CSS. Clicks open #pnav at the levels above.
2. A painter, kappHeadPaint(): name and whether the switcher shows (COMPUTERS_OPENABLE), the avatar. Called from
   worldswOneKosmos (each computers answer) and paintRailMe (the avatar), and once from kplusBar.
3. CSS in the #4823 phone media block: html.kremote.kapptabs .kplus-bar 44px, mark and two lines hidden, the two
   controls shown; colours from the bar (navy, white).
4. pnavClose refocuses the opener; kosmosAppTab likewise.
5. Browser check docs/browser-checks/render-apptabs-6846.js (harness: render-mobilenav-4823's real board over
   remote.test): with kapptabs: no strip, no burger, no mark, no two lines; header 44px; one computer: no switcher,
   avatar shown; two computers: switcher named, opens #pnav at Switch Computers; avatar opens Settings; close returns
   focus to the opener. CONTROLS: the same page without kapptabs keeps today's bar (mark, two lines); 127.0.0.1 with
   kapptabs keeps today's header (kapptabs alone does nothing off Kosmos+). Indices: runner list, README, CI
   allowlist, reason count.
6. mobile-shots.js: an `--app-tabs` flag (adds the class at document start, with --remote), and a `two-computers`
   screen. Design shots for Mona Lisa.

## Weakest premise
That the app's class reaches the page before kplusBar paints. A WKUserScript at document start runs before any page
script, so it does; if part b injected it late, the CSS still applies when the class lands (the controls exist either
way), only the first frame would show the old bar.

## Validation
Focused node run (every web.*.test.js and the guards), both browser-check gates (#1720 coarse, #2518 surface), the new
check in Chromium and WebKit, render-mobilenav-4823 and render-plus-bar-3837 (the header this changes), design shots.
