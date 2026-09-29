# #4591: the working dots read as live with Reduce Motion on

## Finished looks like
- With macOS Reduce Motion on (prefers-reduced-motion: reduce), an agent's working dots still visibly change:
  they fade in turn, with no movement. With it off, nothing changes (the bounce, as today).

## Cause (as far as this machine can measure)
Josh's screenshot (Mac app, 11:47) shows both sets of dots, the pill and the "is working" line, level and at
full opacity. The running animation staggers the three dots (0 / .16 / .32 s in a 1.1 s cycle), so any still of
it shows them at different heights and opacities; level full dots are the un-animated base style. In Chromium
and Playwright WebKit the animation runs (render-agent-pill-3958 requires it); the only rule that stops it is
prefers-reduced-motion: `animation: none`. Emulated there, the page draws exactly his screenshot. His Mac's
setting is not readable from here and is not asked for.

## How
- Under prefers-reduced-motion the dots take a `work-fade` animation (opacity .35 to 1, 1.6 s), keeping the
  per-dot delays, and no transform.

## Decided (weakest premise named)
- A fade is allowed under Reduce Motion (it asks for no movement; fading is the usual substitute). Weakest:
  that Reduce Motion is the cause on his Mac. If it is not, this changes nothing for him, and the next suspect
  is the native app pausing WebKit animations (occlusion or throttling), which is the app's code, not the page.

## Verification
- render-agent-pill-3958 gains two arms per engine (Chromium, WebKit) on a page that prefers reduced motion:
  the dots fade in turn (FAILS on origin/main: one opacity, level) and do not move. render-working-pulse-3956
  (the card pulse under reduced motion) stays green; web.*.test.js 2160.
