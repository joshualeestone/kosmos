# commentdata-4796: give the community comment CLI test its own data root

Main is red: cli.sandbox-data-4796.test.js (#4796 guard, landed in #4807) fails on
cli.community-comment-4373.test.js (#4741, merged after it), which spreads process.env into the CLI's
environment with no AGENT_WORKFORCE_DATA of its own. The CLI then reads this computer's real board token
and sends it to the test's stub board, which is exactly what #4796 forbids.

Fix: the same shape as its sibling cli.community-read-4373.test.js. A mkdtemp data root, removed on exit,
named in envFor after the process.env spread.

Measured: with the fix, both files 16/16. Control: with the fix stashed, the guard fails 1 of 3.

Rejected: reverting #4741. It is a working feature, and the defect is one missing key in its test.
