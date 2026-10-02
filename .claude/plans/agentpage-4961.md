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
- The `#d-nav` and `#s-nav` click handlers pass `{ keyboard: e.detail === 0 }` (Enter/Space on a
  button fires a click with detail 0; a pointer click carries its click count). detailGo and
  settingsGo clear `kbd-landed` from their panel's sections and set it on the target only for a
  keyboard press, before focusing it.
- docs/browser-checks/render-dsec-ring-4961.js (+ README row, + gated.txt): chromium + webkit, light +
  dark, agent page (3 pills) and Settings (2 pills): click arm: focus lands in the section, no outline;
  keyboard arm: focus lands, 2px solid ring. Chromium only: after a click, :focus and :focus-visible
  are forced on the section via CDP (the Mac app's WebKit behaviour), and it must draw no outline.
  Run-count guard ran=40, forced=10.

## Evidence
- On origin/main (check copied into a detached worktree): 10 FAIL, exactly the 10 forced arms; the
  keyboard ring arms pass there (the #350 ring).
- With the change: 95 PASS lines, rc 0.
- node --test browser-checks-*.test.js web.*.test.js tools.browser-checks-*.test.js: 2344 pass, 0 fail.
  web.url-state.test.js pinned `settingsOpen(b.dataset.go);` and now pins the keyboard form. The rest
  of the suite is left to CI and the full validation at convergence.

## Weakest premise
That Josh's stroke is this rule. It is the only outline on .dsec and matches the 16px-radius ring in
the screenshot; Playwright cannot drive the Mac app's own click, so the forced-pseudo arm stands in for
it. If a stroke remains in the app after this ships, the next suspect is a UA default ring on
#d-talk-box (focused at ~35263), which this change does not touch.

## Out of scope (same card, separate PRs)
(b) Fresh Start card touching the terminal (missing section gap, branch dsecgap-4961, stacked on this);
(c) left column sticky buttons overlapping FILES after scroll.
