---
method: challenge-loop
branch: restoreresume-5536
diff_hash: 31521b9c44e10014be43998ed2548caeecae0341be46c3a4a00a726681172734
timestamp: 2026-10-26T04:36:24Z
iterations: 8
converged: false
---

# Challenge-loop proof: restoreresume-5536 (kosmos#5536 slice 3)

Stopped at the 8-round cap, NOT converged: round 8 found one warning, which is fixed, and no round after it ran. The
plan (.claude/plans/restoreresume-5536.md) records each round, the rejected options, the residuals and the weakest
premise. Each round was one fresh blind reviewer with a security focus, given the code, not my conclusions.

#### Iteration 1 (blind review)
No BLOCKER. [WARNING, fixed] record write cap vs read cap; HFS+ NFD names; Windows record identity (O_NOFOLLOW is 0);
the record not bound to a snapshot. NITs taken: modes, hard links, record path cap. Declined: clearing temp folders
after the walk (they must go first).

#### Iteration 2 (blind review)
No BLOCKER. [WARNING, fixed] case-only folder names never resumed on APFS/NTFS (lookups now by collisionKey); a torn
last record line made the record unreadable (dropped, and cut off before the next append).

#### Iteration 3 (blind review)
No BLOCKER. [WARNING, fixed] a part-written then failed record line glued the next one on; Finder's .DS_Store blocked
a resume. NITs: the lock, byte-measured cut, header.

#### Iteration 4 (blind review)
No BLOCKER. [WARNING, fixed] real Finder metadata is 0644 (my test wrote 0600 and could not fail); a backed-up
.DS_Store that Finder rewrote.

#### Iteration 5 (blind review)
No BLOCKER. [WARNING, fixed] a lock caught before its pid was written read as stale (now written whole, then
linked); a same-process lock after a worker ended (token, and the header says child process).

#### Iteration 6 (blind review)
No BLOCKER. [WARNING, fixed] a crash mid-link left a two-name lock refused for ever; a reused pid after a reboot.

#### Iteration 7 (blind review)
No BLOCKER. [WARNING, fixed] pid reuse without a reboot; a wall-clock boot rule a clock step moves. Owner = pid plus
start time.

#### Iteration 8 (blind review)
No BLOCKER. [WARNING, fixed] ps prints the start time in the caller's locale and time zone (Linux now /proc start
ticks plus boot id; elsewhere ps in a fixed locale). NITs taken: a failed ps falls back to signal 0; a same-pid lock
of another start time is stale.

### Final Ledger
- Stopped at the cap after iteration 8 with its warning fixed; no BLOCKER in any round.
- engine/restoreresume-5536.test.js: 24 pass, 1 skipped here (the NFC two-names test, which runs only where the disk
  holds both forms); with restoresink, backuprestore, restorerun, restorefetch and the guards, all pass.
- Mutation arms: 50+ across the rounds, each applied, checked applied, run and restored byte for byte; every arm red
  at the final code except three stated: the NFC two-names arm (disk-dependent), a failed ps on a live pid (needs a ps
  that fails for a live process), and the created-only record cleanup (the lock now stops a second sink first).
- Full validation at 42f2698f1d through queued-heavy: 24084 tests, 0 fail, validation-log PASSED hash d67987a2d8c6
  (the proof's hash at that commit). Run 1 found two repo guards red (#1732 inventory, #1777 Windows list), both fixed
  in 42f2698f1d. Run 2 was green on every node test, but shell shard 2 failed test-queued-heavy-4977.sh, one timing
  check (#5923); it is 142 of 142 alone on the same tree, and this branch does not touch queued-heavy. Run 3 is the
  clean one.
- After the PR: CI's Windows job (the first time restoreresume-5536.test.js ran on Windows) failed three resume
  tests: Windows refuses ftruncate on an O_APPEND file. Fixed in c2b6ee4294 (positioned writes, no O_APPEND; an arm
  without the position reds 4 tests). Full validation again at c2b6ee4294: 24084 tests, 0 fail, validation-log
  PASSED hash 31521b9c44e1, matching this proof's diff_hash. Windows itself is checked by PR CI, not here.
