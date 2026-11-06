# whatsnew-0795b: What's New for 0.7.95, rebuilt after the 0.7.94 prod promote

The 0.7.95 staging cut refused at release.sh step 1b-ii (kosmos#7617 highlights check): prod serves 0.7.94 but
release/whats-new-pool.json recorded lastProd 0.7.93, because #8136 built the pool before 0.7.94 was promoted.

Fix, exactly as the check names it: `node tools/whats-new-pool.js build 0.7.95` on a branch from main 5c7ec5ec46,
output committed unedited. It sets lastProd 0.7.94, marks the four items 0.7.94 showed as shown (shownIn 0.7.94), and
web/whats-new.json now lists the next five eligible items. No item text was written or changed in this branch; every
title and line was already in the pool and reviewed in its own PR (#8136 for the 0.7.95 items).

Check: `node tools/whats-new-pool.js prod-check` passes after the build (it refused before it).
