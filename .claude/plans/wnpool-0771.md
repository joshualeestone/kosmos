# wnpool-0771: What's New after 0.7.71 reached prod (kosmos#7349)

0.7.71 reached Mac prod at 15:3x CDT 10-27 (pointer 967d75f). `tools/whats-new-pool.js build 0.7.72` reads what prod
serves, marks 0.7.71's five highlights shown, records lastProd 0.7.71, and writes the next list (five for Mac, two for
Windows). Generated files only (release/whats-new-pool.json, web/whats-new.json); no hand edits.

Checks: prod-check 0 before the promote (pool and prod both 0.7.70), 3 after it (prod newer), 0 after this build;
whats-new-check 0.7.72 passes for mac and windows; the pool and What's New tests pass (54) and test-whats-new-early-7349.sh.

Why now: the 0.7.72 staging cut's step 1b-ii refuses while the pool is behind prod (this morning's 0.7.71 cut lost an
attempt to exactly that).
