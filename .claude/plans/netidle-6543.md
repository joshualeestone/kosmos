# netidle-6543: mobile-shots survives WebKit's 64-context limit

Card: kosmos#6543. Its premise (networkidle never arrives) did not hold; the cause is corrected on the card.

## Finished looks like
A full mobile-shots run on webkit takes every screen at every size and theme with no goto timeout, and no timeout
was raised to get there.

## Cause (measured)
- render-login-expiry-3532 and render-survival were never broken: the card's runs had no board
  (ERR_CONNECTION_REFUSED in about 1 s), counted as networkidle by a grep that also matches Playwright's call log.
  Against a sandboxed board both pass on main.
- WebKit (Playwright 1.62.1, webkit build 2336) stops navigating in the 64th context of one browser: that goto
  sends no request and times out; the close after it wedges (#6205). Reproduced on a static page with no Kosmos code;
  Chromium loads 72 of 72. A run opens about 70 webkit contexts per size.

## Change
docs/browser-checks/mobile-shots.js only: a fresh engine every 40 screens (CONTEXTS_PER_ENGINE), through the
existing #6205 launch, pid capture and bounded close; `browser = null` before the relaunch so a failed launch cannot
close the old engine twice.

## Rejected
- Raising the goto timeout: the 64th context never navigates at all.
- Relaunching only webkit: one rule is simpler and a relaunch costs about a second.

## Weakest premise
That the limit is per browser and not per process lifetime. Measured: a relaunched engine loads again from zero.

## Verify
webkit, every size and theme: 816 shots, 0 errors (before: 3 errors at se light). node --check OK; the 9 node files
that read mobile-shots.js 109/109. Through the heavy queue, against sandboxed boards.
