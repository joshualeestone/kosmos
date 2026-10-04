---
pre_challenge: true
method: challenge-loop
branch: remoteoff-4743
diff_hash: d35d84a4b8926b0a89af1becdc2e34e9e8a7f892b021864c0d5407fefad9b4b4
subdir_audit: passed
timestamp: 2026-10-03T03:37:37Z
converged: true
---

## Challenge loop (board half): 17 blind rounds; converged at round 17 against the live coordinator code

Ledger with every finding and its disposition: `.claude/plans/remoteoff-4743.md` (Reviews 1 to 17).

## [WARNING] Reviews 1 to 16
Warnings each round were taken or recorded; the recurring one was the ship order (the board half must not reach users
before the coordinator half), satisfied 2026-10-02 15:56 when kosmos-relay #261 (a798dbd1) went live.

## [NIT] Review 17 (sonnet)
CONVERGED. Checked against the live coordinator (macs.rs, macremote.rs, db.rs at relay main):
- off: {"remote":{"on":false}} sets remote_off_since, refreshes last_seen, keeps the stored diagnosis;
- on without a report clears the mark and stores nothing; on with a full report stores it;
- an older flip signed before a newer one is ignored (remote_switch_ts <= signed_ts);
- not enrolled: nothing is sent; no lost flip found; tests pin the exact JSON with deepEqual.
LEFT NIT: the mac-standing.js header does not name the unreadable-settings null (#4308).

## Checks
Full validation PASSED at 729115ac8 (node 14348 / 14125 pass / 0 fail; test:shell; build). Focused 29/29 after the
rebase onto main.
