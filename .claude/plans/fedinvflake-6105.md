# fedinvflake-6105: render-federation-invite-4649 C6 and C7b read an empty line under full-suite load

Card: kosmos#6105 (recurrence of #5373). Test-only change: docs/browser-checks/render-federation-invite-4649.js.

## Cause (read from web/index.html, not guessed)
- Every sheet sentence is said 30 ms after it is set (fedInviteSay, fedInviteCopySaid), so a live region speaks it again.
- A "Copied" line reverts after 2 s (FEDINV_COPY_TIMER -> fedInviteCopyReset clears the line).
- C6 read the bare-Copy busy line after a fixed 100 ms: on a saturated box the 30 ms timer had not fired -> `""`
  (the card's `"bare":["","Copy"]`).
- C7b waited for "Invitation copied.", released the stale write, slept 150 ms and read. Two ways to read `""` under load:
  the 2 s revert of the newer Copied ran first, or the stale write's own second Copied (reset, then said 30 ms later)
  had reset the line and not yet said it (the card's `{"status":""}`).
- C9's "past the Copied revert" used a fixed 2.1 s, the same class (a late revert would leave Copied up).

## Change
- untilCopied(page, text): waits for the line, then cancels its 2 s revert, so the read sees what the wait saw. Only
  the revert is stopped; assertions are unchanged.
- untilReverted(page): the revert has run (timer gone, both buttons say their own words), replacing C9's 2.1 s sleeps.
- C6: busy line by untilStatus; the 3 s limit by untilRefused (was a 3.2 s sleep); the late write by untilCopied.
- C7b: a MutationObserver records every line written after the stale write is released; the arm judges the last
  line written ("Invitation copied."; a line cleared after it reds) and that no "finished late" line was ever written (its real failure, written
  synchronously in the write's handler). Silence still passes, as the file's own note says it cannot tell silence
  from a second Copied.

## Review 1 (opus) fixes
- C1 had the same race: its "says Copied" is now read inside the wait (not frozen, because C1 tests the revert next),
  and the 2.3 s sleep before "reverts" is untilReverted.
- C7b now freezes the stale write's own Copied too and judges the LAST line written (a line cleared after it reds),
  with a 4 s wait that logs a NOTE; press() in C9 logs a NOTE when its wait times out; untilReverted's comment says it
  returns at once when no Copied is showing.

## Review 3 (opus) fix
- C9's run() waits for the last arm's Copied to revert first, so press()'s NOTE fires only on a real timeout (it
  compared against the same sentence and timed out on every passing run, a 3 s stall the old code hid).

## Review 4 (sonnet) fix (its bound is SUPERSEDED by review 5: 1950 to 5000 ms from the press, recorded on the page)
- C1 times its revert on the page's clock from the moment the Copied was seen and requires 1.5 s to 4.5 s (the 6 s
  wait alone let a much slower revert pass, which the old 2.3 s read caught); its snapshot reads the real status line.
  This also covers the too-short revert for C1 (the residual below remains for C6 and C7b).

## Review 5 (opus) fixes
- [BLOCKER] review 4's C1 bound was timed from the first POLL, so node-side latency could red a correct page under load.
  Now the press (a capture-phase click listener) and the Copied and the revert (a MutationObserver) are recorded ON THE
  PAGE as they happen; the revert must land 1950 to 5000 ms after the press (the timer is set at or after the press, so
  a correct revert is never under 2000 ms).
- The same read-after-wait race in C4b, C7, C7c and C7d: they use untilCopied now. C9's press() returns the line its
  own wait saw instead of reading it again.

## Decided, not missed
- Freezing the revert inside the wait changes page state, but only the timer the arm does not test; the alternative
  (racing a 2 s timer on a box that can stall for seconds) is the flake.
- Residual (review 1): untilCopied cancels the revert as soon as the line is up, so a regression that shortened the
  2 s revert to about 100 ms is not caught by C6 or C7b (C1 now times its revert, review 4). Accepted: C1 is the revert-timing check, and the same revert serves every arm.
- Residual (review 5): C1 allows the revert up to 5000 ms after the press, so a revert lengthened to under 5 s is not
  caught, and a page stalled for more than 3 s past the timer reds C1. Accepted: the bound is on the page's own clock.
- Residual (review 2): C7b's wait returns on the first line said, so a line cleared a few ms after the stale write's
  Copied could be missed; a narrow case of the revert-timing residual above.
- Residual (review 1): C6's "nothing said while it waits" (a 300 ms read) and its busy line must both be read before the
  3 s limit; a stall of more than 3 s can still red C6. Accepted: far narrower than the 100 ms window it replaces.
- Not touched: the S arms' 2.2 s "past the create screen's 2 s revert" sleeps (a different screen, not named failing);
  noted on the card as the same class.

## Proof (measured 2026-10-13)
- The check alone (KOSMOS_BC_CI_ALLOWLIST=render-federation-invite-4649) at 0215b69c8: PASS, no retry.
- Load stand-in: the page's two 30 ms say-delays stretched to 400 ms, COMMITTED in throwaway detached worktrees (never
  pushed, removed after), because tools/browser-checks.sh freezes the last commit and an uncommitted swap never runs
  (a first attempt with uncommitted swaps proved nothing and was discarded).
  - new check (bd769eced): PASS on C6, C7b and C9.
  - old check (4ab79713a, the merge base): FAIL twice (with its retry) on C6 (`"bare":["","Copy"]`) and C7b
    (`{"status":""}`), the exact readings the card recorded from the saturated Mortals run. C9 passed there.
