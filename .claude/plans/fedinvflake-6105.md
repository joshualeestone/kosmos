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
  non-empty line ("Invitation copied.") and that no "finished late" line was ever written (its real failure, written
  synchronously in the write's handler). Silence still passes, as the file's own note says it cannot tell silence
  from a second Copied.

## Decided, not missed
- Freezing the revert inside the wait changes page state, but only the timer the arm does not test; the alternative
  (racing a 2 s timer on a box that can stall for seconds) is the flake.
- Not touched: the S arms' 2.2 s "past the create screen's 2 s revert" sleeps (a different screen, not named failing);
  noted on the card as the same class.

## Proof
- The check alone (KOSMOS_BC_CI_ALLOWLIST=render-federation-invite-4649) at this head.
- Load stand-in: the page's two 30 ms say-delays stretched to 400 ms. The new check passes; the OLD check reds under
  the same stretch (control).
