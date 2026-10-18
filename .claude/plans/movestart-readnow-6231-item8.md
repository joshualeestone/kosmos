# Item 8 + #6243 cleanups -- movestart-readnow-6231-item8 (#6231 item 8 / Addresses #6183)

Follow-up to #6433 (item 7, merged e8821baa). Three pieces as logical commits in one PR,
plus one deferred review comment. All line numbers are on this branch (post item-7 merge).

## Done criteria
1. The account-move START path no longer forces an uncached schtasks `/Query /XML` per agent
   for the per-agent `to` read; the stop/put-back clobber guard behaves identically, including
   for a move TO the default account.
2. A direct test covers the async taskkill exit-128 ("already gone" = success) path through the
   win32StepResult normalization.
3. `win32job.running()` (dead sync code) is removed with its sole reference; win32 restart
   liveness detection is unchanged (still via `runningSteps`).
4. Full suite green; challenge-loop converged (no new BLOCKER/WARNING/CONVENTION).

## Piece 1 -- item 8: cache the per-agent `to` read on START (correctness-sensitive)
`engine/accountmove.js` `start()`: the `readNow` closure (:145) is called twice per agent,
`from` (:160, pre-write, usually warm) and `to` (:169). The `to` read runs AFTER
`deps.setAccount` (:162), which busts the TASK_SPEC_CACHE via `forgetTaskSpec`, so it is
guaranteed COLD: one uncached `/Query` per agent. This is the item-8 cost.

`a.to.dir` is consumed ONLY by the put-back staleness/clobber guard in `putBackBefore`
(:293-320): `if (now !== a.to.dir)` refuses the put-back, marks "changed since", maybe
`leftOnOld`. `now` = `deps.readAccount(name)` = `job.configDir || null`.

FIX: replace `to: readNow(name)` with the value `setAccount` just wrote, normalized EXACTLY
as `readAccount` returns it:
  `to = { ok: true, dir: wrote.account.isDefault ? null : wrote.account.dir }`
only when `wrote` succeeded and `wrote.account` is present; otherwise keep today's behavior
(fall back to `readNow(name)` / `{ ok:false }`), so a failed write is not papered over.

WHY this exact normalization (the trap, fails SILENTLY): `setAccount` writes job configDir =
`acct.isDefault ? null : acct.dir` (create.js:1670/1705); `readAccount` returns
`job.configDir || null`. For a move TO the default account, `readAccount` at put-back time is
`null` while `wrote.account.dir` is a concrete dir. Using `wrote.account.dir` (or raw
`body.dir`) as `to.dir` makes `now(null) !== to.dir(dir)` true on EVERY stop, so every
not-reached agent is falsely "changed since", its put-back skipped, and a spurious `leftOnOld`
fires. Must reuse the `isDefault ? null : dir` form.

TESTS: pin the default-account case (a stopped move TO the default account puts the
not-reached agents back: `to.dir === null === readAccount`, not "changed since"); keep the
non-default case passing; assert the START path issues no extra `/Query` for the `to` read
(the cache seam). Keep consistent with `accountmove-stop-6214.test.js:205` (readAccount wiring
shape). Relevant: `accountmove-stop-6214.test.js`, `accountmove-notes-6231.test.js`,
`create.win32-job-read.test.js`.

## Piece 2 -- #6243 cleanup (2): remove dead win32job.running()
VERDICT (investigated on this branch): `win32job.running()` (sync, win32job.js:662-678) is DEAD
on current main. Sole reference: `remove.js:627` (the sync `loaded` closure). The `act`
dispatcher (remove.js:2264) always prefers `ops.steps.loaded` (-> `runningSteps`) because win32
always defines it (remove.js:650); no reachable path (sync restart, async restart, non-restart
caller) hits `running()`, and no test calls it directly.
REMOVE: `win32job.running()` and its sole reference (the `remove.js:627` sync `loaded:` line).
Then re-check the seams used ONLY by `running` (`sleepSync`, `setRunningClock`'s `sleep` arg)
against `setRunner` (win32job.js:124-129) and the `runningSteps` tests; remove only what is
provably unused. `runningSteps` stays (the live path). `idAccepts` is shared, keep it.
Relevant: `remove.win32-restart-3431.test.js`, `remove.win32-job-570.test.js`.

## Piece 3 -- #6243 cleanup (1): async exit-128 taskkill test
`finishKill` (win32stop.js:242-275, line 247) treats `r.code === 128` or `/not found|no running
instance/i` as gone. The SYNC path's 128 case is tested (win32stop.test.js:101). The ASYNC
`endSteps` path (win32stop.js:286-292), which normalizes the driver reply via
`win32job.win32StepResult` (win32job.js:152-158, preserves `code`), is NOT tested with
`code:128`. ADD a direct test using the `driveWin32` helper pattern
(`remove.win32-restart-3431.test.js:99`; mirror the `endSteps` tests at :348/:361): runner
returns `{ ok:false, code:128, stderr:'...not found' }`, `setAlive(() => false)`, assert
`ret.ok === true`. Optionally assert the `/not found/` text branch the same way.

## Also: Raiden's #6433 defensive comment (deferred here, no-change-needed in item 7)
In `putBackAsync` (remove.js), add a comment: `RESTARTING.add(clean)` before the `try` is safe
only because `restoreAccountSteps` is a generator fn and `driveAsync` is async, so constructing
`driven` cannot throw synchronously; a future sync-throw there would leak the hold.

## Known tradeoff / scope
Pieces 2-3 are ancillary #6243 cleanups shipped alongside item 8 per the item-7 plan. If piece
2's seam cleanup proves deeper than the `running()` unit, the `running()` removal still ships
and the seam cleanup is trimmed to only the provably-dead parts. Piece 1 is the only
correctness-sensitive change and carries the default-account regression test as its guard.
