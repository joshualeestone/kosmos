# testenv-0801: the #8293 test holds its sandbox under a release cut

The 0.8.01 cut stopped at step 3: engine/connect-keep-8293.test.js went red, 14 of 23, and stayed red alone. tools/release.sh exports AGENT_WORKFORCE_HOME, and engine/accounts.js prefers it to HOME, so the test's sandbox accounts were not read.

Measured: with AGENT_WORKFORCE_HOME set before the fix, the same 14 fail (15 of 28 after #8330 added five tests). After setting it to the sandbox in the test, every test in the file passes with the variable and without (28 of 28 after #8330 added five). No product change.

Other test files: the cut's node suite named this as the only red file. The shell part never ran, because it runs only after a green node part, so the re-cut is the first time shell tests meet this variable since the last good cut.

The sibling test engine/connect-oldjob-8294.test.js passes with the variable set: it reads no accounts.
