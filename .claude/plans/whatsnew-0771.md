# whatsnew-0771: What's New for 0.7.71, built from the pool

## Why
The 0.7.71 staging cut (the first with KOSMOS_CUT_LINUX=1, kosmos#7281) needs web/whats-new.json for 0.7.71; release.sh
step 1b-ii refuses otherwise. Per #5711 the file is built from release/whats-new-pool.json, never written by hand.

## Change
Four pending items added to the pool (since 0.7.71), from what merged after 0.7.70 froze (c8e01322c8):
- 11.0 shield "A damaged saved file is named, not changed" (#7255 / #7248)
- 11.2 chat "Web addresses are links" (#7244 / #7239)
- 11.4 chat "Tables stay inside their message" (#7236 / #7214)
- 12.6 list "Community activity in Settings, at a glance" (#7254 / #7211)
Then `node tools/whats-new-pool.js build 0.7.71` (prod 0.7.69 already recorded in the pool): the top five are the first
three plus 0.7.70's "A paused room says why" and "A project shows each member's role".

Not included: the iPhone changes (#7276, #7282, #7322, #7274/#7275), which ship in the phone app, not the board; the
Linux family (staging only); Windows-only and test-harness fixes.

## Proof
whats-new-check 0.7.71: 5 highlights (mac 5, windows 5). Tests: whats-new-check-3955, pool-5711, pool-sync-5713,
release-gate: 104/104.
