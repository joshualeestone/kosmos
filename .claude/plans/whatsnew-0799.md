# whatsnew-0799: What's New rebuilt after the 0.7.97 prod promote

Josh approved promoting 0.7.97 at 07:51 CST 11-08 (Kosmos, via Splinter); Baron promoted Mac and Linux by name at
07:5x (site 26c6b21), verified from outside. prod-check then said "prod serves 0.7.97 but the pool records 0.7.94".

Fix, as the tool names it: `node tools/whats-new-pool.js build 0.7.99` on a branch from origin/main 405f013c64, output
committed unedited. It sets lastProd 0.7.97 and marks the four items 0.7.97's window showed on Mac and Linux as shown
(shownIn 0.7.97): Spreadsheets, the orb, the streak note, Always Allow. web/whats-new.json now lists the next five
eligible items, for 0.7.99 (the next cut). No item text is written or changed here.

Windows-only "Kosmos says when others can change its folder" is in 0.7.97's window too, but the pool records Mac
promotes only (tools/whats-new-pool.js header). Windows prod still serves 0.7.94 (latest-win.json, read 08:0x), so it
stays pending. Once Homer's Windows 0.7.97 promote serves, retire it BY HAND: status shown, shownIn 0.7.97, and build
again. If that lands before this PR merges, it is done here; otherwise in the 0.7.99 pool PR.

Check: `node tools/whats-new-pool.js prod-check` passes after the build (it refused before it).
