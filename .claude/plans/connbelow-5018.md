# connbelow-5018: the Claude-unreachable line moves below a floating notice

## Why
Mona Lisa (design, 2026-10-03 00:54): since #5089 the login-expiry notice floats over the page, and it covers the
Claude-unreachable line (#conn, "Kosmos cannot reach a Claude subscription on this computer..."): over the middle of it
at desktop 1280, completely on an iPhone 15. The two show on the same day (an expiring login and an unreachable
subscription are related). #5089 already moves the Allow card and the sticky Settings nav below the notice; #conn did not.
Her design call: #conn gets the Allow card's treatment; nothing that warns is ever covered.

## What finished looks like
With a notice showing, #conn starts below the notice stack in the tab and consolidated views and on a phone; with no
notice, #conn does not move at all.

## Change
- web/index.html, topnotesTrack: also writes --topnotes-clear = stack height + 16px (the 8px the stack floats below the
  header plus 8px of air), 0 when nothing shows.
- CSS: `#askcard[hidden] + #conn { margin-top: var(--topnotes-clear) }`; the agent talk view's #conn rule adds
  --topnotes-h to its own --space-6 gap. Only when the Allow card is hidden: a showing Allow card already moved down and
  #conn follows it.
- render-tophead-stable-2624: a new arm, both views at 1440 and 1100: #conn's top is at or below the stack's bottom with
  a notice, and its margin-top is 0px without one. Controls: both elements render.

## Decisions
- --topnotes-clear rather than a fixed extra gap on --topnotes-h: a fixed gap would move #conn with no notice showing.
- Rejected: moving the notice instead. Its placement is Josh's ruling for #5018.
- Weakest premise: the talk view's #conn keeps --space-6 + --topnotes-h (no extra 8px), reasoned from --space-6 being
  wider than the 8px float gap, not measured in that view.

## Validation
- render-tophead-stable-2624 (headless): the new arm passes in both views at both widths; with --topnotes-h alone
  (no float gap) it failed all four (#conn 3 to 7px under the stack), so the arm can fail.
- Review 1 added the agent Talk view (1440, 390) and the phone tab view (390); with the talk-view rule removed exactly
  the two Talk arms fail (#conn 67 and 99 against stack bottoms 138 and 170).
- The nine surface-mapped checks (render-conn-top-3708 and eight more) pass headless at 276af2d58; trailers recorded.
- Design shots (light/dark, desktop/iPhone 15, chromium and webkit): ~/work/design-shots/kosmos-connbelow-5018;
  Mona Lisa approved the design 01:04.
- Focused node (the file-scanning guards and web.* layout tests): 82/82. Both browser-check gates pass.
- Reviews: 2 blind (opus, sonnet), both CLEAN.
