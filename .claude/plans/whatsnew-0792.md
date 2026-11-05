# whatsnew-0792: What's New for the 0.7.92 staging cut

Card: kosmos#1050. Owner: Baron Draxum. Data only: web/whats-new.json is the output of tools/whats-new-pool.js.

Prod moved to 0.7.91 on 11-05, so the build marks that window's five shown and records lastProd. Two new pool items, rank 9 and
9.5: "When messages get stuck behind an agent" (#8021, a new card that can reach a phone, so a person should be told what it
is) and "A question taken back stays on record" (#7756). They take slots over older lines. Mac tag on the first: its Windows
path is separate and PR #8025 did not measure Windows.

Each clause was read against the code by a blind reviewer; the rewordings are in the pool, not the built file.
