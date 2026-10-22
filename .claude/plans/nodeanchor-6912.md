# nodeanchor-6912: only options may precede the node test token

Card: kosmos#6912 (follow-up to #6907, claimed: icecreamkitty).

## Problem
`tools/site-autodeploy.sh` (#6907) passes over a publisher whose ancestry reaches a node process with `--test` or a
`*.test.js` argument ANYWHERE in its command line, so `node server.js --test` counted as a test runner and a real
publisher under it would not hold the site deploy (the unsafe direction).

## Decision
`nod` allows, between `node` and the test word, only options (`-...` words) and the value of `--require`, `-r` or
`--import`; the test file itself may not start with `-`:
`^([^ ]*/)?node(( -[^ ]+)|( (--require|-r|--import) [^ ]+))* (--test(=[^ ]*)?|[^ -][^ ]*\.test\.[cm]?js)( |$)`.

Measured on this Mac (node 26.8.1), run the way tools/run-tests.sh runs it (`node --test --require <launch-guard>
--require <tool-guard> --test-timeout=... <files>`): the parent is `node --test ...`; each child is the node binary, about thirty `--x=y`
options, then the forwarded `--require` pairs, `--test-timeout=...` and the test file. The separate `--require` value is why
the value is allowed (iteration 1: my first measurement ran node without --require, and the anchored pattern then missed
the real child). The arm uses that measured child line with no matching parent, so it proves the child alone.

Rejected: a list of known runner flags (brittle across node versions); excluding option names from the plain-option
alternative (ERE has no lookahead; see the residual below).

## Weakest premise
That node keeps putting only options and those option values before the test file. If it adds another separate-value
option, a test-started publisher holds the deploy again unless its `node --test` parent is in the walk (a delay, the
safe direction).

## Residuals
- `node --require ./x.test.js server.js`, and likewise `node -e x.test.js` / `node -p x.test.js`, still match (an
  option's value can be read as the test file). Contrived, and the pre-#6912 pattern had them too.
- pid reuse inside one ps snapshot (#6912 item 3): needs a reused pid within one snapshot; the 64-hop cap and the ppid-1
  rule bound the walk.

## Tests
`tools/test-site-autodeploy-5589.sh`: a release.sh under `node server.js --test` holds; one under
`node --title=a.test.js server.js` holds; the real runner child (measured line, no matching parent) exempts.
Mutants, each red: the any-argument pattern (server.js and --title arms); the options-only pattern without the
--require value (real child arm).
