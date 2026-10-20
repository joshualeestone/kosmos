# plusbar-6718: drop the Kosmos+ bar at desktop width; Log out at the bottom of Settings > Kosmos+ (kosmos#6718)

## Goal (Josh, #admin 2026-10-20 08:42)
"If i click on viewing an agent, it hides 50% of the top bar. However, i am thinking we should just move that log out
button to under settings > kosmos+ > and then put it at the bottom." Asked: Log out out of the bar, to the bottom of
Settings > Kosmos+; with Log out gone the bar has no job, so remove it (or say why something else needs it); no layout
jump between the board and an agent's page; check Windows.

## Call
- The bar (#3837 F) is only ever built through a Kosmos+ address (kplusBar, kplusRemote). At desktop widths it is now
  display:none. Its Log out button and message line are removed from it.
- KEPT on a phone: there the bar IS the whole header, the Kosmos+ mark and the menu button that opens #pnav (Josh's
  09-30 navigation mock, #4823), and #pnav already carries Log out. Removing it would leave a phone viewer with no
  header and no menu. So the phone media rule now shows it (display:flex), and nothing else about it changes.
- Log out: a row at the bottom of Settings > Kosmos+ (#plus-logout-row, after the section's card, before the
  "Lost your phone?" overlay). kplusBar reveals it and wires it to kplusLogout, so it shows only through a Kosmos+
  address: at the computer itself there is no Kosmos+ browser session to end. One function for both doors remains
  (Settings and the phone menu).
- Windows app: same web/index.html; the Windows app shows the board at loopback, so neither the bar nor the row ever
  showed there. Nothing Windows-specific.

## Rejected
- Removing the bar everywhere: breaks the phone header and menu (above).
- Showing Log out in Settings at the computer itself: nothing to log out of.

## Weakest premise
That nothing else depended on the desktop bar's height or position: the three browser checks that measured it
(render-plus-bar-3837, render-mobilenav-4823 W1, render-tophead-stable-2624's 1440px bar arm) were updated, and the
other web tests that read the Kosmos+ section pass (100/100). The bare-'/' success branch of kplusLogout (reload after
a fragment-only change) is now reachable only from the phone menu, whose check drives a refusal, so it has no browser
check after this change (it had one, P4, when the button was on the bar).

## Tests
- render-plus-bar-3837.js rewritten: P1 CONTROL loopback (no bar, no Log out row); P2 through Kosmos+ at 1280 no bar
  is drawn and the header starts at the top; P3 the same on the board and on an agent's talk view (no jump); P4 Log
  out is the last thing in Settings > Kosmos+; P5 a refused log out says so; P6 a working one posts once and lands on
  /#signed-out; P7 no page errors; P8 CONTROL at phone width the 48px bar and its menu are still drawn. 12/12.
- render-mobilenav-4823.js W1: at 1280 no bar and no bar Log out. 173/173.
- render-tophead-stable-2624.js: the 1440px bar-Log-out alignment arm removed (no desktop bar). OK.
