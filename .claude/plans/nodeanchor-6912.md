# nodeanchor-6912: only options may precede the node test token

Card: kosmos#6912 (follow-up to #6907, claimed: icecreamkitty).

## Problem
`tools/site-autodeploy.sh` (#6907) passes over a publisher whose ancestry reaches a node process with `--test` or a
`*.test.js` argument ANYWHERE in its command line, so `node server.js --test` counted as a test runner and a real
publisher under it would not hold the site deploy (the unsafe direction).

## Decision
The `nod` pattern allows only options (`-...` words) between `node` and the test token:
`^([^ ]*/)?node( -[^ ]+)* (--test(=[^ ]*)?|[^ ]*\.test\.[cm]?js)( |$)`.

Measured on this Mac (node 26.8.1): the runner's parent is `node --test --test-concurrency=2 <file>` and each child is
`/opt/homebrew/Cellar/node/26.8.1/bin/node --test-concurrency=2 --heap-prof-interval=... ... <file>.test.js`: options,
then the file. Both still match.

Rejected: a list of known runner flags (brittle across node versions).

## Weakest premise
That node keeps putting only options before the test file in a child's argv. If a future node puts a non-option word
first, a test-started publisher holds the deploy again (a delay, the safe direction).

An option that takes a SEPARATE value (`node --require foo --test`) makes the value read as a non-option, so it holds (safe).

## Deferred
pid reuse inside one ps snapshot (#6912 item 3): needs a pid reused within one snapshot; the 64-hop cap and ppid-1 rule
bound the walk.

## Tests
`tools/test-site-autodeploy-5589.sh`: a release.sh under `node server.js --test` holds; the real child shape still exempts.
Mutant: restoring the any-argument pattern turns the first arm red.
