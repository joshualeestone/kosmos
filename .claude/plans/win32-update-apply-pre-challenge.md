---
pre_challenge: true
method: challenge-loop
branch: win32-update-apply
diff_hash: a32816f265afe8b6a020a2ab3395192febf0c4da82ce5f7a13df0424b288f43d
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T17:30:00Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Windows updater, step 3 (S3): apply a staged update and roll it back.** The helper stops
the board, swaps the bundle, restarts and confirms the new board, and on any failure reverses
every step and restarts the old board — crash-safe at every point, and correct when a scanner,
sync client or backup tool briefly holds a file.

**Iterations:** 11 (opus rounds 1-10, plus this Opus-4.8 final scoped round 11). **Converged:**
Yes — the final review of the round-11 diff found NO NEW FINDINGS, all five round-11 changes
verified, and the three new controls proved non-vacuous (each revert reddens its test).

**Proof hash.** `diff_hash` is the sha256 of the raw bytes of
`git diff origin/main HEAD -- . ':(exclude).claude/plans/win32-update-apply-pre-challenge.md'`,
computed with node over git's own output.
- Taken at HEAD `04f9406d` on origin/main `e0e1a922` (502,874 bytes; 11 files, +8044/-47),
  after a clean rebase onto the current main (the only new main commit since review,
  `e0e1a922`/#3000, touches an unrelated browser-check fixture; merge-tree clean).
- The proof file is excluded, so the hash is stable across the hash-writing commit.
- The pre-challenge-gate hook isn't installed on this Windows box, so the recipe is written out.

## What shipped
- `engine/win32apply.js` (new): the apply/rollback state machine (H2 stop, H3-H8 swap, H7
  confirm, cleanup), `recoverAtBoot`, and the ownership/held-read/held-write discipline.
- `engine/win32update.js`: the shared `tryRetryingHolds` retry primitive (returns the error),
  `readFileRetryingHolds`, `releaseLock` returning `released`/`left`/`not-ours`, and the
  `RENAME_RETRY_WINDOW_MS` export.
- `engine/win32board.js`: the BOOT_JS shim honours a boot choice (`bootFrom`) and reads the
  journal with the held-read rule.
- Colocated tests and the plan round logs.
- **Nothing is armed:** SELF_INSTALL stays darwin; no route or task invokes the apply helper
  yet (S4 arms it, and needs Josh's Q5).

## The invariants the review converged on
1. **Ownership before every side effect.** `assertStillOwner` precedes every scheduler call and
   every write (the K-table, K01-K18). A proven takeover (`LostOwnership`) makes no scheduler
   call and no further write.
2. **A held or unreadable filesystem answer is never proof.** Only ENOENT/ENOTDIR means gone;
   EBUSY/EPERM/EACCES/EIO are retried within the caller's budget (QUICK 3x20ms for B0/begin/CLI;
   OWNER 31x200ms for the helper/resumers/shim; writes 2 tries QUICK / 6 tries OWNER, each try
   spending one `RENAME_RETRY_WINDOW_MS`); still-unknown means held or `unreachable`, never
   `moved`, `abandoned` or a rollback. This holds for reads AND writes (the read and write sweep
   tables in the plan).
3. **A board H7 confirmed is never rolled back**, and `recordConfirmed` retries held write codes
   within a 60s patience.
4. **The board is never left down by a held failure the design can recover from.** A run that
   ended the board (`stopBoard` sets `boardEnded` before `/End`, so a timed-out-but-effective
   `/End` still counts) and exits held/stuck/unhandled issues exactly one `/Run` AFTER the lock
   is released (`finishRun` -> `restartBoardAfterExit`), never before it and never after a proven
   takeover. If the lock can't be released, no `/Run` and a logged line (accepted residual).
5. **No boot deadline** (round 7 reversal): a launcher hand-off ending a slow recovery is a crash
   the design recovers from; the worst case before `listen` with persistent holds is ~65s,
   bounded by `rollbackPasses`.

## Accepted residuals (coordinator rulings, in the plan)
- The logon shim at `starting` can't run H7's check (IgnoreNew), so a `confirmed` record that
  couldn't be written within the 60s patience rolls back to the working old build.
- A persistent EACCES entry at boot ends `stuck` with `bootFrom` previous.
- A lock that can't be released leaves the board stopped until the next sign-in or Kosmos.exe.
- A board serving the same release from another folder can confirm ROOT's update (harmless;
  identity matches, and the installer's `anchorBundle` re-points the fleet).

## Round history
- **R1-R2:** ownership at every site; the `unreachable` held path; NIT B (8.3 via
  `realpathSync.native`); NIT C (a pointer with no app refused).
- **R3-R4:** the read held-rule (`presenceOf`, `tryRetryingHolds`); recovery files; K02/K18 tests.
- **R5:** the read sweep across ~20 sites; budgets; the `confirmed`-no-rollback rule.
- **R6:** `previousAppMayBoot`; `recordConfirmed` retries held writes; held re-reads stay held.
- **R7:** REVERSAL — removed the boot deadline (it cut the clock under read-only decisions and
  caused 3 bugs) and reverted the `startedByTask` requirement (it would roll back a
  launcher-served update).
- **R8:** the WRITE held-rule swept across `save`/`writeStatus`/`begin` writes; `HeldWrite`;
  the post-`held` `/Run`.
- **R9:** the `/Run` moved AFTER the lock release; `exitLeavesBoardDown` as the one restart rule;
  returned-held carries `action:'held'`.
- **R10:** 1 low BUG + 4 NITs (found; fixed in R11).
- **R11 (this round):** `boardEnded` before `/End`; `not-ours` -> stderr only; `abandoned` logs
  and still no `/Run`; comment + K18. Final scoped review: NO NEW FINDINGS (converged).

## Validation of record (final, at code commit `6bb6864a`, then rebased clean to `04f9406d`)
Kosmos runtime node v24.19, schtasks preload guard, `KOSMOS_SCHTASKS_BLOCK_LOG` a scratch file
that stayed absent, APPDATA/LOCALAPPDATA/USERPROFILE in scratch, every heavy step under the
shared `heavy-run-mutex.ps1` lock.

- **Controls: 123 of 123 red**, one per locked step, tree clean after, no block log. The final
  scoped review independently confirmed C125/C126/C127 pin their fixes (revert -> red) and the
  re-pointed C66/C78/C108/C116 still bite.
- **S3 suites:** `win32apply` 101/101, `win32update` 98 + 1 skip, `win32board` 47/47,
  `win32anchor` 18/18, `win32swap` 25/25.
- **35-file comparison vs a `git archive` of `b31b7610`** (archive vs archive, one file per
  locked step): branch 700/673/26/1 vs base 581/554/26/1. No difference by test name and first
  error line; the 26 shared failures are the 25 `machine.test.js` Mac-contract cases plus
  `fixture-discipline` (git ls-files in an archive); the 119 branch-only tests all pass or skip.
  `web.win32-board-copy` passes on both sides (#2997 fixed the #2910 regression). `e0e1a922`
  changes nothing in this set, so the comparison still holds post-rebase.
