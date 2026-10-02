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
- One document `focusout` listener drops `kbd-landed` when a section loses focus, so the ring belongs to
  the keypress: Tab inside, then click the section's background, and it refocuses without a ring.
- The other buttons that move focus into a section pass the same flag: Files View All and its back
  link, Sign in again, and the two "Open AI Models" / "see them on the Accounts tab" links.
- docs/browser-checks/render-dsec-ring-4961.js (+ README row, + gated.txt): chromium + webkit, light +
  dark, agent page (3 pills) and Settings (2 pills): click arm: focus lands in the section, no outline;
  keyboard arm: focus lands, 2px solid ring. Chromium only: after a click, :focus and :focus-visible
  are forced on the section via CDP (the Mac app's WebKit behaviour), and it must draw no outline.
  Then: keyboard-land on AI Settings, Tab inside, click the Model heading: no outline (forced too on
  chromium). Run-count guard ran=40, forced=10, outlived=4.

## Evidence
- On origin/main (check copied into a detached worktree): 10 FAIL, exactly the 10 forced arms; the
  keyboard ring arms pass there (the #350 ring).
- With the change: 105 PASS lines, rc 0.
- node --test browser-checks-*.test.js web.*.test.js tools.browser-checks-*.test.js: 2344 pass, 0 fail (2344 tests).
  Source pins restated for the new call shapes: web.url-state (s-nav), web.reauth-reach-1918 (Sign in
  again; its fake click now passes an event), web.agent-files-3614 and web.agent-nav (View All),
  web.conn-live (the Accounts link). The rest
  of the suite is left to CI and the full validation at convergence.

## Weakest premise
That Josh's stroke is this rule. It is the only outline on .dsec and matches the 16px-radius ring in
the screenshot; Playwright cannot drive the Mac app's own click, so the forced-pseudo arm stands in for
it. If a stroke remains in the app after this ships, the next suspect is a UA default ring on
#d-talk-box (focused at ~35263), which this change does not touch.

## Out of scope (same card, separate PRs)
(b) Fresh Start card touching the terminal (missing section gap, branch dsecgap-4961, stacked on this);
(c) left column sticky buttons overlapping FILES after scroll.
