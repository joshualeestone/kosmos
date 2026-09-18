# consolidated-white-bg-3264 -- consolidated message ground -> white (--k-surface)

kosmos#3264. Josh's brand-owner instruction (design chan, 2026-09-18): "the background is supposed to be white just like it is on the tab view." Reverses #980 iter-5's cream (--k-bg) tuning of the consolidated view. Mona routed (needs an in-app eye); Angel builds (bg-layering lane) + verifies headlessly.

## Change (web/index.html) -- 3 lockstep flips, ONE change so #980's band cannot return
1. `html[data-layout="consolidated"] body.consolidated .pj3 > .pjmid`: background var(--k-bg) -> var(--k-surface) (the white ground).
2. `html[data-layout="consolidated"] body.consolidated .pjmid .composer`: var(--k-bg) -> var(--k-surface). LOCKSTEP -- #980 repainted the sticky composer to --k-bg to hide the band; flipping the ground without this returns the band (glaring in dark).
3. NEW consolidated-scoped override for the wing-carve mask `.msg:not(.you) .msg-bd::after`: var(--k-surface). The global rule stays --k-bg (untouched, so the tab view is unaffected); on the consolidated white ground the carve must be white or a cream sliver shows at the tail tip.

## Verify (headless browser-check, runs in a bot -- no MCP)
`docs/browser-checks/render-consolidated-white-3264.js`: puts the page in consolidated layout, injects the .pj3 > .pjmid > .composer + a .msg-bd, and asserts the COMPUTED background of .pjmid, .composer, and the ::after carve all == a painted var(--k-surface) probe (and != var(--k-bg)), in LIGHT and DARK; plus a NO-REGRESSION control that the NON-consolidated carve keeps --k-bg (the override did not leak to the tab view). Token-pinned, not an exact rgb, so a Josh retune of --k-surface stays green while a regression of any of the three back to --k-bg reds it.
Run: `NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-consolidated-white-3264.js` -> all passed (light+dark, 6/6).

Headed AESTHETIC confirm (does it look right to the eye) = Josh's in-app review at the cut (he reviews in the running app).

## Authorization / weakest premise
Reverses #980's deliberate cream tuning -- authorized by Josh's explicit brand-owner instruction (his call on brand). Weakest premise: the headless check pins the computed TOKEN, not the lived aesthetic; the headed look is Josh's in-app review. No count bump needed (the runner globs docs/browser-checks/*.js).
