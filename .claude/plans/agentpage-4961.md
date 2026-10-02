# #4961 (a): no black stroke round an agent page section

**Done looks like:** in the Mac app (WebKit), clicking or keyboard-activating an agent page nav pill
moves focus into the section as before, and no outline is drawn round the section.

## Cause
`.dsec:focus-visible { outline: 2px solid var(--k-ink); outline-offset: 4px; }` (from #350). detailGo()
focuses the section on every pill activation. WebKit in the Mac app matches :focus-visible on that
focus after a click (Safari does not focus the clicked button), so a 2px ink ring drew round the
16px-radius card (Josh's screenshot, 2026-10-01 22:17).

## Change
- web/index.html: replace the rule with `.dsec:focus { outline: none; }` plus a why-comment. Sections
  are tabindex=-1 landing spots, not tab stops; the next Tab's control draws its own ring.
- docs/browser-checks/render-dsec-ring-4961.js (+ README row): chromium + webkit, light + dark, click
  and keyboard arms on three pills: focus lands in the section, section outline none. Control: a forced
  outline reads as one. Run-count guard 24.

## Evidence
- On main: 12 FAIL (every keyboard arm, both engines, solid 2px). Click arms pass on main: Playwright's
  WebKit focuses the clicked button, so it does not reproduce the Mac click case (stated in the check).
- With the change: all 57 PASS lines, rc 0.
- node --test browser-checks-*.test.js web.*.test.js: 2319 pass, 0 fail (reason-grep unchanged: the
  check uses the ternary chk and bare-object catch shapes, which the scan does not count).

## Weakest premise
That Josh's stroke is this rule. It is the only outline on .dsec and matches the 16px-radius ring in
the screenshot; the Mac app's click path cannot be driven here. If a stroke remains in the app after
this ships, the next suspect is a UA default ring on #d-talk-box (focused at ~35263), which this
change does not touch.

## Out of scope (same card, separate PRs)
(b) Fresh Start card touching the terminal when its status line grows; (c) left column sticky buttons
overlapping FILES after scroll.
