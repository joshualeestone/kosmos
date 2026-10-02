# #4961 (a): no black stroke round an agent page section after a click

**Done looks like:** in the Mac app (WebKit), clicking an agent page or Settings nav pill moves focus
into the section as before and draws no outline round it; pressing the pill from the keyboard still
draws the #350 landing ring.

## Cause
`.dsec:focus-visible { outline: 2px solid var(--k-ink); outline-offset: 4px; }` (from #350). detailGo()
and settingsGo() focus the section on every pill activation. Safari does not focus a clicked button,
so in the Mac app the focus moved next can match :focus-visible after a click, and the 2px ink ring
drew round the 16px-radius card (Josh's screenshot, 2026-10-01 22:17).

## Change
- web/index.html CSS: `.dsec:focus { outline: none; }` and `.dsec.kbd-landed:focus { <the #350 ring> }`.
- One flag, `DSEC_KEYBOARD`, declared above detailGo, set while a key press is under way: a
  capture-phase `keydown` without a modifier sets it, and the task after its `keyup` clears it (Enter
  activates a button on keydown, Space on keyup); a capture-phase `pointerdown` clears it and removes
  `kbd-landed` from every section. detailGo and settingsGo clear `kbd-landed` from their panel's sections and set it on the
  target only when DSEC_KEYBOARD is set, before focusing it. No handler or source pin changes. Every
  route into a section goes through those two functions (reasoned from the code); only the nav pills
  are measured.
- Rejected after review: passing `{ keyboard: e.detail === 0 }` from each handler. It missed routes,
  needed a focusout cleanup that also fired on an app switch.
- docs/browser-checks/render-dsec-ring-4961.js (+ README row, + gated.txt): chromium + webkit, light +
  dark, agent page (3 pills) and Settings (2 pills): click arm: focus lands in the section, no outline;
  keyboard arm: focus lands, 2px solid ring. Chromium only: after a click, :focus and :focus-visible
  are forced on the section via CDP (the Mac app's WebKit behaviour), and it must draw no outline.
  Enter and Space arms both expect the ring. Then: keyboard-land on AI Settings, Tab inside, click the
  Model heading: no kbd-landed, no outline (forced too on chromium); and a scripted .click() on a pill
  lands without the ring after that pointer press and after typing in the message box. Run-count
  guard ran=60, forced=10, outlived=4.

## Evidence
- On origin/main (check copied into a detached worktree): 10 FAIL, exactly the 10 forced arms; the
  keyboard ring arms pass there (the #350 ring).
- With the change: 153 PASS lines, rc 0.
- Controls, each measured red in exactly its arms: pointerdown keeping the class (outlive arms); a
  ring regardless of input (click, forced and scripted arms); no keyup clear (after-typing arms); a
  synchronous keyup clear (Space arms).
- node --test browser-checks-*.test.js web.*.test.js tools.browser-checks-*.test.js: 2344 pass, 0 fail.
  The rest of the suite is left to CI and the full validation at convergence.

## Weakest premise
That Josh's stroke is this rule. It is the only outline on .dsec and matches the 16px-radius ring in
the screenshot; Playwright cannot drive the Mac app's own click, so the forced-pseudo arm stands in for
it. If a stroke remains in the app after this ships, the next suspect is a UA default ring on
#d-talk-box (focused at ~35263), which this change does not touch.

## Out of scope (same card, separate PRs)
(b) Fresh Start card touching the terminal (missing section gap, branch dsecgap-4961, stacked on this);
(c) left column sticky buttons overlapping FILES after scroll.
