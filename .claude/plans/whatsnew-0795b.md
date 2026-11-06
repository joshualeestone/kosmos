# whatsnew-0795b: What's New for 0.7.95, rebuilt after the 0.7.94 prod promote

The 0.7.95 staging cut refused at release.sh step 1b-ii (kosmos#7617 highlights check): prod serves 0.7.94 but
release/whats-new-pool.json recorded lastProd 0.7.93, because #8136 built the pool before 0.7.94 was promoted.

Fix, exactly as the check names it: `node tools/whats-new-pool.js build 0.7.95` on a branch from main 5c7ec5ec46,
output committed unedited. It sets lastProd 0.7.94, marks the four items 0.7.94 showed as shown (shownIn 0.7.94), and
web/whats-new.json now lists the next five eligible items. No item text was written or changed in this branch; every
title and line was already in the pool and reviewed in its own PR (#8136 for the 0.7.95 items).

Check: `node tools/whats-new-pool.js prod-check` passes after the build (it refused before it).

## Review round 1: one hand retirement

0.7.94 showed five highlights, not four: the tool marked four, and left the fifth ("Settings says when crash recovery
is not set up") pending because it is Windows-only and the pool records Mac promotes only. The tool's header
(tools/whats-new-pool.js lines 19-20) says such an item is retired BY HAND once Windows prod has shown it. Windows prod
serves 0.7.93 (live https://chaoskosmos.com/dist/latest-win.json, read 11-06), and 0.7.93's build (e9f745d813) showed
it, so it is now status shown, shownIn 0.7.93, and the build was run again. It gave its slot to "Old project summaries
say why" (already in the pool, rank 16.8). That one edit is the only hand change; web/whats-new.json is tool output.
