# msgref-4601: render-msgref-4631 R12 clicks the menu item where it is drawn

Card #4601 (this check is in the per-PR allowlist and blocked moving the job to Linux).

## Measured (lxmeasure-5052 runs, Linux WebKit, Playwright 1.62.1)
- First attempts failed about half the time (0.7.17-era main, runs 37036328772 onward). Traced to the Copy click: right
  before it the menu is OPEN (state polled every 25ms), then page.click('#msg-menu-copy') times out "element is not
  visible". page.click scrolls its target into view first, and the page closes this menu on ANY scroll
  (`window.addEventListener('scroll', () => msgMenuClose(false), true)`).
- Two other scroll sources were found on the way (first-run's delayed focus, the room's settle scroll to scrollY 144);
  waiting for them alone did NOT fix it (3/3 first attempts still failed). The click change alone did.

## Change
docs/browser-checks/render-msgref-4631.js R12: the Copy click is page.mouse.click at the item's bounding-box centre.

## Verification
- Linux, the real check with only this change: 3/3 runs passed with no retry (37067574645, 37067771814, 37067928945).
- Before (control): about half the first attempts failed (e.g. 37066118757, 37066547431, TimeoutError at the click).
- Mac: see the PR (run queued in the light lane).

## Iterations
### Iteration 1 (sonnet, blind): 0 blockers, 0 warnings. CONVERGED.
Verified: mouse.click sends the same real pointer events; the menu's mousedown preventDefault and click handler still
run; .msg-menu is position: fixed, so the old scroll was never needed; a mis-hit fails loudly (no false pass).
Left: an elementFromPoint diagnostic guard (nice to have), a stale-coordinates nit (no realistic shift), comment wording.
