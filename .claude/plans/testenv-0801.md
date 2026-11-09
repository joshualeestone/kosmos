# testenv-0801: the #8293 test holds its sandbox under a release cut

The 0.8.01 cut stopped at step 3: engine/connect-keep-8293.test.js went red, 14 of 23, and stayed red alone. tools/release.sh exports AGENT_WORKFORCE_HOME, and engine/accounts.js prefers it to HOME, so the test's sandbox accounts were not read.

Measured: with AGENT_WORKFORCE_HOME set before the fix, the same 14 fail. After setting it to the sandbox in the test, 23 of 23 with the variable and without. No product change.

The sibling test engine/connect-oldjob-8294.test.js passes with the variable set: it reads no accounts.
