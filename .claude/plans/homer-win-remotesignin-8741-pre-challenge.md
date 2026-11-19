---
method: challenge-loop
branch: homer-win-remotesignin-8741
diff_hash: b40b30a574ea9e8d1bc6fe6c5873c62aa6d3067c40e241f557082fe82f03d7ce
rounds: 1
converged: true
blockers_open: 0
date: 2026-11-19T17:11:09Z
---

# Pre-PR review proof: homer-win-remotesignin-8741 (#8741)

One fresh blind CTO-lens review agent, given the two stacked commits (this one and change 2), the issue and the goal, not my conclusions. It traced every path to openSigninPageOnce and host.open, noOpener's lifetime across flows, the page link and wording, and test platform safety, and ran the win32signin, connect.win32signin and #8728/#8741 connect tests.
- Round 1: 0 BLOCKER, 0 WARNING, 3 NIT. Converged: no BLOCKER or WARNING to fix. NITs and what was done with each are on the plan.

Hash taken against origin/main at 97c408c58c, HEAD 482b231fd7.

## What the reviewer checked, round 1
- Every path that opens a page: openSigninPageOnce has one caller (win32signin.js, the stdout data handler), now gated on session.noOpener; noOpener is read from the launch on each open(), and each open() makes a new session.
- connect.js has one host.open call, reached only through launchSignin, passing owner.noOpener === true; no retry, relaunch or first-run path opens another way.
- claude's own opener stays the no-op (BROWSER = where.exe via withNoOpOpener), asserted by the new test.
- With the Windows host switched off, signinHost() returns null and nothing starts.
- noOpener lifetime: fixed per flow when the owner is built; writeState takes it from the owning driver and deletes it otherwise; the connect test runs remote, cancel, local and asserts it is false afterwards.
- The page link is the printed manual one (usableOauthUrl/extractOauthUrl read claude's screen); the localhost rewrite lives only inside openSigninPageOnce.
- Every "your browser has opened" wording on the page sits behind signinOpensNoBrowserHere(st), true when st.noOpener is.
- Tests fail without each fix (controls present); connect.win32signin.test.js pins win32 through seams, so it is safe on macOS/Linux CI.

## Findings, round 1
- [NIT] The negative unit check waits a fixed 100 ms. Kept: it also asserts the port finder was never asked, which catches a delayed open.
- [NIT] Pre-existing from #8728, all platforms: a remote viewer joining a flow started locally sees "your browser has opened". Cosmetic (fallback link and paste still work); for a separate card.
- [NIT] "No newline at end of file" in win32signin.test.js: checked, not so; the file ends with a newline, as on main.
