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

## Review round 1 (blind, opus) and what was done
- [WARNING] W1 untrue comments (the #5379 padding rule, kplusBarFit, the #4506 observer note named P2/P8 arms that
  no longer drive it) --> FIXED, each comment now says what is true after #6718.
- [WARNING] W2 dead wide-bar code: the consolidated padding selector for .kplus-bar and kplusBarFit's wide
  (min-width 56.01rem) padding branch, both for a bar that is display:none there --> DELETED.
- [WARNING] W3 the mobilenav header probe read #plus-logout, which sits in Settings and is never drawn on the board,
  so H4 and W1's "no Log out" could not fail --> FIXED: it now finds any visible Log out in .apphead. MUTANT (a
  desktop bar with a Log out put back): H4 and W1 go red in chromium and webkit; restored by byte copy (cmp clean).
- [WARNING] W4 P4 saw only the not-connected pane --> FIXED: P4b answers the connected pane's routes as
  render-plus-panel-3829 does, precondition Remove this computer is drawn, and Log out is still last. 14/14.
- [NIT] assert headH equal in P3 --> DONE (51 = 51).
- [NIT] Log out contrast, use an outline pill --> NOT CHANGED: it is the board's standard .btn, the same as Leave
  company and Cancel in the same section; a different style for one button is a design call outside this card.
- [NIT] wording "Log out of Kosmos+" --> NOT CHANGED: it sits under the Kosmos+ heading, and Josh's word is "Log out".

## Review round 2 (blind, sonnet)
- [WARNING] kplusBarFit ran on every header resize at desktop widths, where the bar is undrawn --> FIXED: it returns
  at once when the bar has no box; a turn to phone width fires resize, which fits (render-mobilenav-4823 173/173,
  which turns between widths; render-plus-bar-3837 14/14).
- [NIT] the base .kplus-bar declarations are mostly overridden by the phone rule --> NOT CHANGED: the phone bar
  inherits its colours and the margin hook from them, and the comment above says so; collapsing two rules is churn
  in a stylesheet other cards edit.
- [NIT] the kplusLogout comment ran long --> REWRAPPED.
- [NIT] .kplus-bar-end now wraps one button --> NOT CHANGED (harmless; the phone CSS keys on the structure).
- [NIT] the phone H4 "no Log out in the header" is weak because the header never held one there --> TRUE and kept:
  it is the guard that one is not put back; the W3 mutant shows it goes red when one is.

## Review round 3 (blind, opus)
- [WARNING] docs/browser-checks/README.md rows for render-plus-bar-3837 and render-tophead-stable-2624 described the
  old bar and a deleted arm --> FIXED, both rows say what the checks hold now.
- [WARNING] no check loads at desktop width and turns to a phone width, the path the early return relies on -->
  MEASURED, NOT ADDED. I wrote that arm (load at 1280, turn to 390, assert the bar edge to edge) and it passed; then
  a MUTANT with the resize listener and both ResizeObservers removed passed it too. At phone width the base rule's
  calc(-1 * var(--space-8)) margins already equal the header's padding, so an unfitted phone bar is already edge to
  edge: the refit is not observable there and an arm for it cannot fail. Removed rather than kept as a guard that
  cannot go red. Weakest premise: a future change to the phone header's padding would make the fit matter again,
  and then nothing checks it.
- [NIT] the kept #3837 history said #5379 pads the bar --> FIXED ("padded it ... until #6718").
- The reviewer traced first load at phone width, a header not yet laid out, desktop to phone and phone to desktop
  and found no stale-margin path.

## Review round 4 (blind, sonnet): converged
- No new issues found. [NIT] the consolidated .kplus-bar margin rule now touches only the phone bar (harmless);
  [NIT] spacing above #plus-logout-row is not asserted (P4/P4b assert it is last and shown). Neither changed.

## Validation 1 (on e38ad69b, tree untouched): 22524 tests, 2 FAILED, both mine (source pins on lines this branch changed)
- web.rhythm-1303a "item 1: the grey band is gone": it pins the anchor `body.consolidated > .apphead header {` to ONE
  rule. Taking `.kplus-bar` out of the #5379 selector list left that rule ending in exactly that text, so it matched
  twice. FIXED: the #5379 rule says `.apphead > header`, the same element (the page's one header is a direct child of
  .apphead) with the same specificity. 6/6 (run from the repo root; the test reads web/index.html by a relative path).
- browser-checks-gutter-yardstick #3973: it pinned the root-gutter measurement in render-plus-bar-3837, which the
  rewrite removed with the desktop bar's edge-to-edge check. FIXED: that check leaves the list (the bar is not drawn
  at desktop widths; the phone bar's fit was measured unobservable in review 3), and the #4213 arm picks its file by
  name instead of by index. 2/2.
- render-tophead-stable-2624 OK and render-plus-bar-3837 14/14 after the selector change.
- Lesson recorded: a selector edit can complete ANOTHER rule's pinned anchor text; the web tests read index.html as text.

## Validation 2 (on 89b4e9c7, tree untouched)
- 22524 tests, 2 failed, both engine/create.test.js "the startup script, actually run ..." (26.9 s and 36.6 s):
  load timeouts in code this branch does not touch (it changes only web/index.html, browser checks and one test).
  Both pass run alone (2/2, load 18). AUDIT_RC 0. Validation 1's two real failures (mine) are fixed and stay green.
