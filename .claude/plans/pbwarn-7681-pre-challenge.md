---
pre_challenge: true
method: challenge-loop
branch: pbwarn-7681
diff_hash: 00a959f9e1c79d11964242f9721684a035c4cb27191d56c91b84b6d2ce292d4e
validation: focused (the branch's tests and the three files the first full suite reddened, 98/98 on the head rebased onto main; both browser-check gates pass; the full suite is CI's, on the exact head)
subdir_audit: not run (no subdir CLAUDE.md in the diff)
timestamp: 2026-10-31T20:23:38Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3. Round 2 and round 3 returned no BLOCKER; round 3's one WARNING (no real print dialog) is carded as
#7694 (needs-device), not fixable on this Mac.
**Controls:** each item's check turns red with its fix reverted; the new "I saved it" test turns red with the clear removed.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] the restore did not re-check inside the key write --> FIXED (e73eee281b)
- [WARNING] the words screen showed the earlier price, not the confirmed one --> FIXED
- [WARNING] a printout could keep the code after printing --> FIXED

#### Iteration 2
- No BLOCKER or WARNING.
- [NIT] the confirmed price asserted on its way to the screen; a failed print leaves no listener or timer --> FIXED

#### Full suite (between rounds 2 and 3)
- [BLOCKER] a static #pb-printout was a 43rd body child, past the layout's 42 rows --> FIXED (made only to print)
- [BLOCKER] pbPrintClear's lookup by id met the page harness's stub on every hide (web.plus-stale) --> FIXED (held in PB)
- [WARNING] the browser-check gates --> FIXED (trailer; a comment's surface words reworded)

#### Iteration 3
- [WARNING] the print fix never ran in a real browser's print dialog --> CARDED #7694 (needs-device)
- [NIT] the "I saved it" exit had no test --> FIXED
- [NIT] fake-dom remove() kept the id in getElementById --> FIXED
- [NIT] a double press leaves one harmless listener; exact price match must stay canonical on both sides --> left
