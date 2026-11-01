---
pre_challenge: true
method: challenge-loop
branch: holdfar-7654
diff_hash: f0fb13eda9dcb969e4a28c39087e702cee35cf38a73feeb5d2799c740b494161
subdir_audit: passed
timestamp: 2026-11-01T21:23:36Z
converged: false
---

## Reviews, not converged

Earlier heads had two review rounds before the cause was known; the findings below are the two rounds on the jump read, the change that met the bar. Round 2 had no blocker and its fixes had no third round.

## Round 1 of the jump read (b08d7f4250)
- [BLOCKER] an app move landed after the stand-down, so back to the room from the archive would be undone. FIXED, ignored for 0.3 s.
- [WARN] the hold's own writes recorded as jumps. FIXED, nothing is recorded with the keyboard up or the hold working.
- [WARN] an offset shift with nothing moving on screen reads as a jump. NOT FIXED for re-measured rows; trace prints content height.
- [WARN] only the last jump kept, and a settle ended it. FIXED, chained, 20 pt slack.
- [WARN] lastJump not cleared at will-show or will-hide. FIXED.
- [WARN] in the DM a jump showing the end turns the hold off first. NOT FIXED, old behaviour, noted on #7690.
- [NIT] a jump past what is drawn leaves no row to read: left.
- [NIT] Date is not monotonic: left.
- [NIT] offsetWatch not released off window: left, harmless.

## Round 2 (7f0dd2638c)
- [WARN] a page landing above read as a jump. FIXED, pageLanded.
- [WARN] the same end-marker path as above. NOT FIXED, on #7690.
- [NIT] a keyboard already up could use a leftover jump. FIXED.
- [NIT] appMovedAt is stamped more widely than its name: comment added.
- [NIT] two-step jump past the window, status-bar scroll: left.

## Measured
Six CI runs on f1cc9d12ca (Renet): proxy 0 of 6 failed (3 of 6 on the head before), drag 6 of 6. The fix fired on attempt 1 with a green. Of three attempts that printed, the race came once; three printed nothing, so unknown.
Whole job green 3 of 6: rebuild 2 of 6 (also on main) and testRoomNewestStaysAboveTheBox 2 of 6, which is not in main's job. This head is f1cc9d12ca rebased on main, plus this plan; no UI run on the rebase. Logic tests pass after the rebase.
Nothing measured on a phone; accessibility on or off is unknown.
