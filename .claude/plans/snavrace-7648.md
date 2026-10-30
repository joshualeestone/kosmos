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

## Results

- Review: five blind rounds so far (opus, sonnet, opus, sonnet, opus). Round 1 added the call-counting control; round
  2 moved the count into the forced poll's own evaluate; round 3 added this section; round 4 narrowed the count to
  pollAsk; round 5 found nothing new in the code.
- Local browser run (15:54 CDT, after 0.7.76 served on staging): render-snav-head-4979 passes on chromium and webkit,
  149 PASS, 0 FAIL, "all checks passed", precondition ran=16 notesRan=2. The new control reads pollAskPaints 1 on both
  engines; every first-pill line reports hitWas "button".
- Mutation control (15:55 CDT): the same check with only the paintAsk stub line removed fails 6 checks, the same 3 on
  each engine: the Allow card not shown (askShown false, the nightly's failure), pollAskPaints 0, and the Allow card
  position. So the arm now reproduces the nightly race on every run, and the stub is what keeps it green.
- The control counts only repaints whose stack names pollAsk (round 4: the page's pollWaiting also repaints). Weakest
  premise was that both engines keep the pollAsk frame in the stack after its await: measured, both read 1. A 0 would
  mean that premise failed or /api/remote/pending errored (pollAsk returns before painting); either way not the race.
