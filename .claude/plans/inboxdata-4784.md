# inboxdata-4784: give the inbox CLI test its own data root

Main is red since #4821 (inbox-4784, merged 23:09): cli.sandbox-data-4796.test.js (the #4796 guard) fails on
cli.inbox-4784.test.js, whose envFor spread process.env with no AGENT_WORKFORCE_DATA of its own, so the CLI would
read this computer's real board token and send it to the test's stub board. My branch was validated before #4796's
guard reached it, and I did not rerun the guard against main before merging.

Fix: the same shape as Renet's #4829 for cli.community-comment-4373.test.js. A mkdtemp data root, removed on exit,
named in envFor after the process.env spread.

Measured (worktree off origin/main 44b16b9c0): with the fix, both files 9/9. Control: without the fix, the guard
fails 1 of 3 (the named file).

Rejected: reverting #4821. It is a working feature, and the defect is one missing key in its test (Splinter 23:30:
fix forward, path C).
