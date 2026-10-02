# tabcenter-2624: the center tabs stay put when the view flips

Card: joshualeestone/kosmos#2624 (Josh: the top header is pixel-stable across views, "must not jitter or shift by a single pixel").

## Measured first (headed, Agent1s, ANGLE Metal / Apple M4, 10-02)
On the served 0.7.18 page and on origin/main 50021fd76 (a 10-02 snapshot; main has moved since), at 1400x950 and 1024x640, every header control is identical in
the tab and one-screen views: the K mark, the Kosmos switcher, the You button, the light/dark and view buttons in the
You menu, and the 51px height. The exception is the center tabs (Agents / Projects / Tasks, shown in both views since
#4345). At 1400px they start at x 607 in the tab view; in one screen they start at 613.8 with a short Kosmos name and
697.5 with a long one (the switcher caps at 220px). So flipping the view moves them sideways by 7 to 90px, and in one
screen they also move whenever the Kosmos name changes.

## Cause
The tab view's header is a `1fr auto 1fr` grid (the tabs in the middle column, centred on the window). The consolidated
rule overrides it with `display: flex; justify-content: space-between`, so the tabs sit in whatever space the left
cluster leaves.

## Change
- web/index.html: the consolidated header rule drops its own display (flex space-between), so it uses the tab view's
  `1fr auto 1fr` grid (top alignment from the #2624 960px rule). The children already carry `justify-self` start / center / end (the rules near the top of the file),
  so nothing else moves. Its own padding, background and rule are unchanged; its gap is now the tab view's 24px (was 12px).
- render-tophead-stable-2624.js: measures the tabs' x and the switcher's width; a long-name arm per width fails if the
  tabs start at different x in the two views, or move with the name in one screen. CONTROL: the long name really
  widened the switcher. Mutation (the old flex rule back): 6 reds at 1440, 1100 and 960 (re-measured after 960 was added; 4 before), "they move 90.5px when the view flips".
  The check runs at 1440, 1100 and 960 (the narrowest width with both views); the 1400x950 and 1024x640 numbers above
  are from the card's sizes, measured with ~/.cache/claude-handoffs/renet-header-2624-measure.js.
- Review 1 and 2: the consolidated rule no longer states display, columns or gap at all (it had flex, then a copied
  grid with a 12px gap, then a second literal 24px). The header keeps the tab view's own .apphead header grid, so
  the two views cannot drift apart by one value being edited.

## Checked, unchanged
Headed or HEADED=0, on the branch: render-tophead-stable-2624 (with the new arm), render-tophead-consolidated-2282,
render-worldsw-height-2350, render-worlds-switcher-1704, render-worldswitch-2238, render-worldsw-lockout-3055,
render-newlook-4470 (189/189), render-update-toast, render-help-tips-3574, render-conn-top-3708, render-plus-bar-3837,
render-dm-emoji-3744, render-consolidated-layouts (on a sandboxed board).

## Not mine, seen on the way
render-login-expiry-3532 fails "at 375 the notice does not cover New agent" on my sandboxed board, identically on
origin/main. 375px cannot be the one-screen view, and the runner boots a seeded board for this check, so it may be my
harness. Left to the runner's result.

## Weakest premise
That the file:// page lays out the header as the served board does. The switcher is forced visible with a typed name
(no worlds over file://), as the existing #2624 check does; a served board with two real Kosmoses is not measured here.
- Review 5: the check also compares the K mark's and the You cluster's left edges and the tabs' top in both views
  (a top-only compare stayed green when the one-screen padding was changed: padding 40px reds klinkX and youX).
