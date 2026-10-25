---
method: challenge-loop
branch: iosparity-7084
diff_hash: 997890d0cc773f92a604195cca6aed9d8d7a1aec6f36814a73947d782c8e4084
timestamp: 2026-10-25T04:24:53Z
iterations: 1
converged: true
---

# Challenge-loop proof: iosparity-7084 (kosmos#7084)

The plan (.claude/plans/iosparity-7084.md) records the finding and its fix.

#### Iteration 1
No blocker.
[LOW, taken] Discovery recognised one shape of read (repoText / appendingPathComponent), so a future suite reading
the board another way would be unguarded in silence. Fix: every other suite that reads the repo (KOSMOS_REPO) may
read only ios/ files; anything else fails and names the read. Arm: actions pointed at docs/push.md reds it.
[LOW, taken] The skip reason said "Linux CI", but the condition is "no swiftc" (also a Mac without Xcode). Fix: it
now says no swiftc and that the suites were NOT checked there.
[LOW, recorded] On a 10-minute timeout node kills only the runner, so a hung swiftc or test binary and its temp
folder can outlive it. Needs a hang first; not fixed here.
[LOW, recorded] The premise (a full validation on a Mac before every web or engine merge) is a fleet convention,
not a CI gate. A PR merged without one is caught at the next iOS PR, as before.

### Final Ledger
- Converged at iteration 1. ios.board-parity-7084.test.js: 6 pass; arms in the plan red as expected.
- Full validation (queued-heavy) at a76278c420: VALIDATION rc=0 AUDIT rc=0, 23863 tests, 0 fail.
