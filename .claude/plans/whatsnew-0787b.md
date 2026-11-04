# whatsnew-0787b: What's New for 0.7.87, rebuilt after the 0.7.86 prod promote

The first 0.7.87 cut (19:09 CST 11-03) stopped at step 1b-ii, correctly: 0.7.86 was promoted to prod at 19:05, so prod
serves 0.7.86 while the pool still recorded 0.7.83 and its five highlights were not marked shown. Nothing was frozen
or claimed. `node tools/whats-new-pool.js build 0.7.87` now records prod 0.7.86 in release/whats-new-pool.json, marks
the five 0.7.86 highlights shown there, and builds web/whats-new.json from the next five eligible items. No version
between 0.7.83 and 0.7.86 reached prod (0.7.84 and 0.7.85 were staging only), so nothing else needs recording.
