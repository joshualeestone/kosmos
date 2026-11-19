---
method: challenge-loop
branch: homer-win-remotesignin-8741-stack
diff_hash: fd138915175810d7186c1443692244ed5275009a0e913ac3393d3411157ca647
rounds: 1
converged: true
blockers_open: 0
date: 2026-11-19T19:48:43Z
---

# Pre-PR review proof: homer-win-remotesignin-8741-stack (#8741 change 2)

One fresh blind CTO-lens review agent reviewed this change together with change 1 (as the two stacked commits 24588d8b7f and df408f53d2 on #8728's branch), given the issue and the goal, not my conclusions. Change 1 merged as #8744. This branch was then rebased onto main after #8728 slice 1 merged (#8747); its 54 changed lines are identical to the reviewed df408f53d2 (checked by diffing the two patches' +/- lines).
- Round 1: 0 BLOCKER, 0 WARNING, 3 NIT. Converged.

Hash taken against origin/main at 25c60b657d, HEAD 820d2a98ef.

## What the reviewer checked, round 1 (as it bears on this change)
- connect.js has one host.open call, reached only through launchSignin, passing owner.noOpener === true; no retry, relaunch or first-run path opens another way.
- With remoteStarted no longer excluding win32, owner.noOpener is fixed per flow when the owner is built; writeState takes noOpener from the owning driver and deletes it otherwise.
- The connect-level Windows test runs remote, cancel, local and asserts noOpener is false afterwards, so the flag cannot leak into a later local flow.
- The page link is the printed manual one (usableOauthUrl/extractOauthUrl read claude's screen); the localhost rewrite lives only inside the Windows host's openSigninPageOnce, which noOpener now skips.
- Every "your browser has opened" wording on the page sits behind signinOpensNoBrowserHere(st), true when st.noOpener is, so a remote Windows start shows the cloud wording and the link button.
- Without this change, noOpener stays false on win32 and both the flipped connect.test.js assertion and the new connect.win32signin test fail (negative control run: the new test fails with the exclusion put back).
- connect.win32signin.test.js pins win32 through seams (spawn, opener, port finder are fakes), so it is safe on macOS/Linux CI.

## Findings, round 1
- [NIT] (change 1's unit test) the negative check waits a fixed 100 ms. Kept: it also asserts the port finder was never asked.
- [NIT] Pre-existing from #8728, all platforms: a remote viewer joining a flow started locally sees "your browser has opened". Cosmetic (fallback link and paste still work); for a separate card.
- [NIT] "No newline at end of file": checked, not so.
