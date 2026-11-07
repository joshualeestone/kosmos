#!/bin/bash
# kosmos#7609: what a ui-sample run did, from xcodebuild's log, one line per test by its LAST result, so a test retried by
# -retry-tests-on-failure counts once. Prints: "<test> passed|failed|skipped" and, for a test that failed and then did not, "<test> flaky".
# Usage: ui-sample-tally.sh <xcodebuild log>
sed -n -E "s/^Test Case '-\[KosmosUITests\.([A-Za-z0-9_]+ [A-Za-z0-9_]+)\]' (passed|failed|skipped).*$/\1 \2/p" "$1" \
  | awk '{ k = $1 "." $2; if (!(k in last)) order[++n] = k; if ($3 == "failed") everFailed[k] = 1; last[k] = $3 }
         END { for (i = 1; i <= n; i++) { k = order[i]; print k, last[k]; if (last[k] != "failed" && (k in everFailed)) print k, "flaky" } }'
