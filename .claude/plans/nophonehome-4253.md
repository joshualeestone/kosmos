# nophonehome-4253: harness boards never phone home

## Why

kosmos#4253. The public install count on installkosmos.com (33,107 on 2026-09-27) is mostly fake.
`engine/createdbeacon.js` sends an install ping on every board start and skips only under
`NODE_TEST_CONTEXT`, which only node's own test runner sets. Harnesses that boot `server.js` from bash
(`tools/browser-checks.sh`, the shell tests `tools/run-tests.sh` drives, the release bundle smoke in
`tools/build-kosmos-bundle.sh`) sandbox `AGENT_WORKFORCE_DATA`, so every boot mints a fresh install id
and registers a new "install". Measured: one allowlisted browser-checks run sent 14.

Hard constraint (Josh, 2026-09-14, #3038): the real install ping is never removed or made
opt-out-able. So the beacon is not changed; only the harnesses are.

## The change

- `tools/browser-checks.sh` and `tools/run-tests.sh` export, at top level before any board boot,
  `AGENT_WORKFORCE_CREATED_URL=http://127.0.0.1:9/api/created` and
  `AGENT_WORKFORCE_FEEDBACK_URL=http://127.0.0.1:9/api/feedback` (a dead local port, the pattern
  browser-checks already uses for its other outbound URLs). Every child inherits them.
- The bundle smoke boot in `tools/build-kosmos-bundle.sh` carries the same two on its own env block.
- `tools/test-install.sh` (the release cut's install gate, dozens of sandboxed boards per run through
  install/setup.sh) exports both at top level, and its `env -i` reboot simulation names both, since
  env -i starts from an empty environment.
- `engine/feedbacksend.test.js`: the arm that pins the DEFAULT endpoint clears the override for its
  one send, since run-tests.sh now sets it.
- New `tools.no-phone-home-4253.test.js`: a CONTROL arm boots the real server.js with
  NODE_TEST_CONTEXT removed and asserts the install ping arrives at the URL the variable names; the
  other arms assert both harness scripts export both URLs to loopback at top level before their first
  boot, and the smoke boot carries both.

Rejected: a `KOSMOS_NO_PHONE_HOME` switch in the beacon (an opt-out a real install could set);
suppressing when `AGENT_WORKFORCE_DATA` is set (`install/setup.sh:1320` sets it for real installs).

## Evidence

- Same command, caller sets `AGENT_WORKFORCE_CREATED_URL` to a sink: origin/main delivered 14 pings,
  this branch 0 (its export overrides, aiming every boot at the dead port).
- `origin/main`'s feedbacksend.test.js under the harness env: 1 fail; this branch: 0.

## Review 1

- BLOCKER, fixed: tools/test-install.sh boots dozens of sandboxed boards and a cut runs it as the
  install gate; it had neither variable. Top-level export beside its sandbox export, plus both names
  in the env -i reboot simulation. The guard covers both.
- The top-level check was a column-0 string match, so an export inside a never-called function (or
  under `if false`) passed. The guard now counts block depth from column-0 openers and closers.
  Mutations, each red: function wrap, if-false wrap, test-install export removed, env -i name removed.
- The feedback URL has a structural guard only (its send is an hourly sweep a short boot never
  reaches); the test file says so.

## Review 2

- Review 2 found no path among the bash harnesses (every harness boot, the test:shell chain, the env -i
  reboot simulation, the smoke boot). It did not look at node tests, and Review 3 found one that
  phones home (below). The real team-board deploy is correctly untouched.
- The depth reader never closed a function: `\}` followed by `\b` cannot match. It closes a column-0
  `}` now, pinned by a direct test on a small script (the old regex reds it).
- test-install.sh's boot pattern skipped the real first installer run (a `VAR= sh` prefix) and anchored
  on a later one; widened, and a test asserts it finds the first (the old pattern reds it).
- run-tests.sh boots nothing in its own text, so only the top-level check applies to it; the test says
  so.

## Review 3

- BLOCKER, fixed: server.guide-on-connect-3660.test.js spawns server.js with a hand-built env, so
  NODE_TEST_CONTEXT never reached the board and every run of its three tests sent a real install ping.
  It names both URLs now. A new guard scans every *.test.js that spawns server.js and requires a
  process.env pass-through or the URL (measured: that file was the only one; engine/sandbox.test.js
  copies process.env key by key). It covers both shapes that boot a board in a child, server.js as
  the script (11 files) and a `node -e` child requiring it (16), and fails below 20 found, so a matcher
  gone blind cannot pass. My first floor came from the reviewer's rough count and caught the matcher
  seeing only the first shape.
- BLOCKER, fixed: the depth reader did not see `function name {` or `function name() {` openers, so an
  export inside such a never-called function passed. Both styles are in its self-test now.

## Review 4

- BLOCKER, fixed: the node-test guard judged whole FILES, so one safe spawn (or a comment naming the URL)
  cleared a second, hand-built one in the same file. It now judges each spawn: it finds the call's `env`
  and follows only names that carry a whole environment in (the env itself, a helper call, a spread, an
  Object.assign argument), with a name judged by its last declaration plus later lines that mention it.
  A property value (`HOME: sb`) is not followed. Comments are stripped. Its self-test pins seven shapes.
- It covers docs/browser-checks/*.js (they boot boards under browser-checks.sh's export), `'node'` as the
  program, a server.js path held in a name, and a `node -e` child requiring a named server path.
  Measured: 46 files boot a board (the guard's own file is excluded), all safe; the floor is 40.
- Mutations on real files, each red: the guide-on-connect fix removed; a second hand-built spawn added to
  a file that already has a safe one; a comment naming the URL above an unsafe spawn.
- My own errors in this round: I set the floor twice from a guess (20, then 40 before measuring 33, then
  47), and my first per-call version followed every name on every line, which let `boot(sb)` vouch for an
  unrelated spawn. Both were caught by running the mutation, not by reading.

## Review 5

- BLOCKER, fixed: options passed as a NAME (`const opts = { env: ... }`, `opts.env = ...` later, a
  helper that builds them) had no `env:` inside the call, so the analyzer read "no env, inherits" and
  passed a hand-built env. It now reads the call's third argument itself: absent inherits, a literal is
  read, a name is resolved through its declaration and any later `name.env =`, a helper through what it
  returns, and anything it cannot read is judged unsafe. Five shapes are in the self-test.
- The follow depth is a named MAX_DEPTH of 6 with a comment (past it: unsafe, loud).
- test-support/*.js is scanned too (a future shared boot helper would sit there).
- Mutations on real files, each red: `opts.env =` after the literal, a named options object, and the
  three from review 4.

## Review 6

- BLOCKER, fixed: a spread of process.env followed by `NODE_TEST_CONTEXT: undefined` (or '', or a later
  `delete env.NODE_TEST_CONTEXT`) passed; the child then pings for real. Dropping it is now unsafe unless
  the URL is named (which is what the CONTROL does).
- BLOCKER, fixed: fork(module), exec strings and `sh -c` strings running server.js were not read at all
  (fork's module is its FIRST argument). All three are recognized now.
- 🛑 THE CLAIM IS NARROWED, not just the code widened. Each review has found a spawn shape the reader did
  not model, and a partial reader fails OPEN on every shape it does not know. The analyzer's header now
  says it is a lint for the shapes this tree uses, lists what it models, and names what actually keeps a
  test board quiet (NODE_TEST_CONTEXT reaching it, or the harness export). A further finding that is
  only a new, unused spawn shape deduplicates against THIS entry; one that is a real boot in the tree, or
  a modelled shape judged wrong, does not.
- The plan's count was 47; the guard measures 46 because it excludes its own file. Corrected.

## Review 7

- BLOCKER, fixed: the comment stripper blanked only whole-line comments, so a trailing
  `// AGENT_WORKFORCE_CREATED_URL ...` inside a multi-line env literal read as the URL. It now blanks
  trailing `//` comments outside a string on the same line. (Review 8 showed that was still per line:
  see below.)
- Naming the URL counted whatever its value was, even the real endpoint. It counts now only as a
  loopback value, the rule the harness checks already apply. Self-tested both ways.
- The file header said "Two halves" over three parts.

## Review 8

- BLOCKER, fixed: the stripper still reset its string state at every line, so a `//` inside a
  multi-line template literal (a URL on a continuation line) cut the rest of that line, which could hide
  a server.js require or a dropped NODE_TEST_CONTEXT. It is one pass over the whole source now,
  carrying the open quote across lines for templates, keeping newlines, and not opening a block comment
  inside a string. Three self-tests pin it. Review 7's ledger line claimed more than the code did; it is
  corrected above.

## Review 9

Three false "safe" verdicts in mechanisms the lint claims to model, each now failing closed:
- several spread sources: the first safe one vouched for the rest, though a later spread wins at
  runtime. Every source must be safe on its own now.
- an options helper was judged by its FIRST return, not the one that runs. Every return must be safe.
- a later bare reassignment (`env = ...`) was ignored for the stale declaration. The last reassignment's
  value is judged now.
Each is a self-test. None is used by a real spawn in the tree today.

## Review 10

- No blocker. The bash depth reader does not know heredocs (none sits before an export in the three
  scripts today); its header now says so, as the JS lint's does. The file header called "about 7,000 a
  day" measured; it now says thousands a day and cites the one measured day (7,086 on 09-25, the admin
  read's silentByDay).

## Weakest premise

A harness started outside these three entry points (a check run by hand with node, a /verify-live
local board, a walk) still pings. Test: the daily new-id count should fall to near zero within a day
of this reaching main.
