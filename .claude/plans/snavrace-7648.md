# snavrace-7648: two timing races in render-snav-head-4979 (kosmos#7648)

## Why
The nightly full run went red once (run 41086666097, after three green nights) on render-snav-head-4979, a different
arm each attempt, each passing on the other attempt, at identical geometry. Not a product regression.

1. Floating-notice arm: it un-hides #askcard by hand, then waits ~600ms. `setInterval(pollAsk, 5000)` -> `paintAsk`
   re-hides an empty Allow card, so a poll inside that window fails the arm (`askShown:false`).
2. Tabs 900px click arm: `elementFromPoint` at the first pill hit something else at unchanged geometry. The check did
   not say what, so the culprit is unknown.

## Finished means
- The floating-notice arm stubs `window.paintAsk` before un-hiding the card and forces one real `pollAsk()` every run,
  so the race is exercised each night, not by chance. Mutation control: without the stub, the arm fails locally.
- The tabs click arm prints what took the click (`hitWas`) on every run, so a miss names its culprit.
- render-snav-head-4979 passes locally on chromium and webkit.

## Not changing
web/index.html. If `hitWas` later names a real element covering the pill, that is a product bug and gets its own card.
