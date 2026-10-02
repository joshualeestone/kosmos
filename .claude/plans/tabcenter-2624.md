# tabcenter-2624: the center tabs stay put when the view flips

Card: joshualeestone/kosmos#2624 (Josh: the top header is pixel-stable across views, "must not jitter or shift by a single pixel").

## Measured first (headed, Agent1s, ANGLE Metal / Apple M4, 10-02)
On the served 0.7.18 page and on origin/main 50021fd76, at 1400x950 and 1024x640, every header control is identical in
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
- web/index.html: the consolidated header uses the same `1fr auto 1fr` grid (`align-items: start`, the #2624 top
  alignment kept). The children already carry `justify-self` start / center / end (the rules near the top of the file),
  so nothing else moves. Its own padding, gap, background and rule are unchanged.
- render-tophead-stable-2624.js: measures the tabs' x and the switcher's width; a long-name arm per width fails if the
  tabs start at different x in the two views, or move with the name in one screen. CONTROL: the long name really
  widened the switcher. Mutation (the old flex rule back): 4 reds, "they move 90.5px when the view flips".

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
