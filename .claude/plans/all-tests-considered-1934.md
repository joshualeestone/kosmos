# kosmos#1934: every *.test.js is considered by the suite

## The problem, measured

`tools/run-tests.sh` runs the node suite with a two-root path glob: `node --test engine/*.test.js *.test.js`.
The repo's test-file naming convention uses DOTS as a pseudo-namespace at the ROOT
(`engine.reachable.test.js`, `install.banner.test.js`, `cli.help-flag.test.js`) WHILE a real `engine/`
directory also exists. So `engine.reachable.test.js` (root, a dot) and `engine/reachable.test.js` (dir, a
slash) read identically to a human and are matched by different globs.

The consequence: a path glob like `engine/*.test.js` that some pre-merge validation used matched the ~131
files IN the directory and silently MISSED the ~251 at the root, INCLUDING the five named `engine.*` that
most strongly imply they were included. That is exactly how a red `engine.reachable.test.js` sat on
origin/main under FOUR merges, each with an honestly green PR check: the validation globbed a slash and
never saw the dot, and a glob matching a subset still exits 0 with a healthy tally.

## The fix (two halves)

### 1. A runtime coverage guard in tools/run-tests.sh
Gather the suite's glob set ONCE into an array, count every `*.test.js` in the tree (node_modules pruned),
and REFUSE TO RUN (exit 1, named) if the glob covers fewer than exist. Then run the SAME counted set, so the
count and the run cannot drift.

- `KOSMOS_TEST_FILES=(engine/*.test.js *.test.js)` under `nullglob`. The two globs are DISJOINT (slash vs
  no-slash) so nothing is double-counted, and every globbed file is necessarily counted by `find` (the globs
  cannot reach node_modules, the only pruned subtree). So `considered` is always a subset of `exist`, and
  `considered == exist` therefore means set equality (full coverage). `-lt` fires on ANY shortfall.
- A narrowed glob, or a suite dropped into a NEW subdirectory, fails loudly with the count instead of
  passing green on a fraction. The failure is always in the SAFE direction: a coverage gap makes exist >
  considered and refuses to run; `considered > exist` (which would bypass the guard) is not constructible.

### 2. A durable node test: tools.all-node-tests-considered-1934.test.js
The sibling of `tools.every-test-runs.test.js` (which does this for `tools/test-*.sh`). Three assertions:
- A POPULATION FLOOR (found >= 300) so the walk cannot pass by finding nothing.
- Every `*.test.js` lives at the repo root or directly under engine/ (the two globbed roots), so a suite in
  a new subdirectory fails HERE, at suite time, named, long before it can sit unrun and green.
- run-tests.sh keeps the coverage guard, pinned by the guard's SHAPE (`_considered`, `-lt "$_exist"`, and
  running `"${KOSMOS_TEST_FILES[@]}"`) rather than by a comment, so it cannot be silently reverted to a
  bare glob.

### 3. A comment in tools/release.sh
Documents WHY the cut runs the whole suite on main itself and does not trust the green PR checks of what it
bundles: a green PR check is a statement about a branch against its own merge base, not about the trunk it
lands on. Comment-only.

## Decisions and what I rejected
- Guard placed in run-tests.sh (runs every time) AND pinned by a durable test (so it cannot be deleted).
  Rejected: a test alone (deletable) or a guard alone (no suite-time catch of a stray subdir file).
- Run the exact counted set rather than re-globbing at the `node --test` line, so count and run cannot drift.
- Deferred robustness NITs (all safe-direction): a bash-3.2 empty-array `set -u` abort is unreachable (the
  repo always has test files, cwd is pinned) and hardening it would break test 3's exact shape-pin; find
  prunes only node_modules while the JS walker also skips .git, a harmless asymmetry that only ever makes the
  guard MORE conservative (refuse to run), never a false green.

## Red-capability, proven
- Runtime guard: a stray `*.test.js` in a deeper subdir makes exist=383 > considered=382 and the guard fires
  ("COVERAGE GAP (kosmos#1934)"). Verified.
- Durable test 2 (stray file): fails naming the stray, verified with the same injected file.
- Durable test 3 (guard shape): reverting run-tests.sh to the bare glob (git checkout origin/main) fails
  test 3 ("the #1934 coverage guard is gone"); restored via git checkout, all three pass again.
- Full suite green: 3898 tests, 3898 pass, 0 fail; guard passes at 382 == 382.
