# goldbtn-4059: polished gold pills with a liquid light

Card: joshualeestone/kosmos#4059. Decided 2026-09-28 00:28 (Mona Lisa, under the never-wait rule): study A
(polished gold), which Josh picked on 09-27, at size 2 ("Larger", `data-size="3.3"` in the study), fully
rounded pills with the light clipped inside, per his 09-27 12:48 notes.

## Done means

- Every GOLD primary button (`.uprime` where the surface keeps it gold) is a 999px pill in polished gold A.
- The #14161a label clears 4.5:1 on every rendered pixel of the fill: at rest (light and dark), on the CSS
  hover (the reduced-motion context), and with the light showing (G2d). The fill tokens do not vary by theme,
  so the dark theme is measured at rest only.
- Hovering a gold button shows the liquid light from the study, at size 3.3, behind the label, clipped to
  the pill, lingering and fading after the pointer leaves.
- Exactly one WebGL canvas exists for the whole app, however many gold buttons are hovered.
- No frame loop runs when nothing is visible (host hidden, light faded, pointer resting still).
- Reduced motion: no canvas, no sim, the hover only darkens. No WebGL: the same, and nothing throws.
- No button changes size or moves. The keyboard ring stays visible on the pill.
- The size is one constant, `GOLD_LIGHT_SIZE`, with the other two study values in its comment.
- `docs/browser-checks/render-gold-buttons-4059.js` pins all of the above in Chromium and WebKit, wired in
  the README and gated.txt, and every arm has been seen to go red with its fix removed.

## Approach

- CSS (`web/index.html`): three tokens on `:root` (`--gold-polished`, `--gold-polished-hover`,
  `--gold-polished-shadow`, plus `--gold-end`) and the `.uprime` rule uses them, with `border-radius: 999px`
  and a transparent border of the same width. The per-surface gold overrides under `#firstrun` and
  `#import-found` use the same tokens. `--gold-light: 1` marks a gold button; the blue ask card, Kosmos+
  (`#plus-state2`) and the found rows' Added state set it to 0 and keep their own shape and no shadow.
- JS: its own attributed `<script id="gold-light">` block (so the page tests' bare-script extractor never
  sees it). The study's stable-fluids sim, restructured so programs compile once and `size()` rebuilds the
  buffers for whichever button hosts the canvas. Delegated pointer listeners on the document, so buttons
  painted later are covered with no wiring.
  The block sits in the head, not the body: the body grid reserves exactly one row per direct child, so a
  39th child left the pre-rail row test red (web.consolidated-980). In the head it behaves the same, since
  all it does on load is add listeners to the document.

## The shared-canvas decision, and why

One canvas, one WebGL context, moved into the button under the pointer. Browsers cap live WebGL contexts at
about 16 and the page source carries 76 `class="btn uprime..."` attributes (counted 2026-09-28); the study's one-canvas-per-button
would lose contexts (and the oldest context is dropped silently) as soon as enough were painted. Only one
button can be under the pointer at a time, so one light is all that is ever visible except during the
linger, and moving to another button resets the light there, which the card allows.

## Rejected

- One canvas per button (the study): the context cap above.
- A 2D-canvas or CSS radial-gradient light: cheaper, but it is not the liquid Josh chose.
- Keeping the study's bronze ends (#7a5410): 2.68:1 under the label. The ends are #b2841e and the bottom
  shade and bevel are lighter (6% and 25%, from 35% and 55%), which keeps the metal read.
- `position: relative` in CSS on every gold button: a gold button that is positioned already would move.
  The script sets it only on a static host, only while it hosts.

## Weakest premise

That the lighter ends still read as "polished gold A" to Josh. The study's darker bronze cannot meet 4.5:1,
so this is the closest that does; the rendered floor is 4.61:1 (Chromium, the big pill's rim), so there is
little room to darken further. Second: the hover arms run in headless engines with software WebGL; a real
GPU could differ in speed but not in what is drawn where.

## Also on this branch, and why

- `docs/browser-checks/render-dm-reply-4256.js`: each scenario now clears `TALK_PENDING`. CI's browser-checks on
  PR #4311 selected this check because the page changed, and it failed twice. A "Sending…" row leaked from R3's
  second send into every later scenario (R13 read 6 rows, R6c a third answer), about one run in three, and also
  on main. Without the fix this PR cannot go green. It is its own commit (723640d) so it can be found and
  reverted alone. Control: with that send's reply slowed to 1.5s, the old check fails exactly so every time and
  the fixed one passes.
- The two gold gradients end in a solid gold layer, so the button's computed background-color is gold. CI's
  contrast check and render-agent-nav's #4051 arm both read that value, and it had been transparent.
