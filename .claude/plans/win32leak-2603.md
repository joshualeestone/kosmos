# win32leak-2603: win32 tests leak backslash-named dirs into the worktree cwd

Card: joshualeestone/kosmos#2603 (claimed:pigeonpete).

## Problem (reproduced)

`engine/win32anchor.test.js` and `engine/win32job.test.js` reach
`anchor.ensureAnchored({platform:'win32', ...})`, which does a real
`fs.mkdirSync(path.win32.join(...), {recursive:true})`. On macOS a backslash-spelled win32 path
has no `/` separators, so recursive mkdir creates a SINGLE directory whose literal name contains
backslashes (`\private\var\...\kosmos-anchor-XXXX\Kosmos\runtime`), relative to `process.cwd()` --
the worktree. The tests pass and `run-tests.sh` exits 0, but the challenge-loop validation helper's
post-run worktree-cleanliness check then records the tree dirty, so the local validation gate is
permanently red on every macOS worktree, for every agent, independent of the change under review.
CI (browser checks) is unaffected, so PRs still go green while the local gate silently erodes.

Measured: from a clean worktree, `node --test engine/win32job.test.js engine/win32anchor.test.js`
-> 20 pass, exit 0, then `git status --porcelain` shows 4 untracked `\private\...` / `\var\...`
backslash dirs.

## Fix

Run each of the two win32 test files from an ISOLATED temp cwd: at module load, `process.chdir`
into a fresh `mkdtemp` dir, and a `test.after` restores the original cwd and removes the temp dir.

- PREVENTS the leak reaching the worktree (any cwd-relative backslash dir lands in the temp dir),
  rather than cleaning it up after -- so the worktree stays clean even if an arm throws.
- The tests still rely on the real fs ops (their `existsSync(r.node/r.boot)` assertions), so
  skipping the mkdir (card option 3) would break them. Isolating cwd keeps the assertions valid:
  they resolve r.node/r.boot against the SAME cwd the mkdir used.
- No production-code change (ensureAnchored takes no injectable fs). `anchorDir` is pure and the
  other arms use absolute temp paths, so neither depends on cwd being the worktree.
- Safe under the runner: `--test-isolation=process` gives each file its own process, so the chdir
  cannot affect a sibling test file.

## Verified

- Before fix: 4 backslash dirs leak (reproduced on origin/main).
- After fix: 20 pass, `git status --porcelain` shows only the two modified test files (no leak).

## Weakest premise

That `--test-isolation=process` holds (each file its own process), so the module-level chdir is
scoped to this file. If the runner ever shared a process across files, a concurrent file could see
the changed cwd between this file's chdir and its `test.after` restore. Mitigated: the restore is in
`test.after` (runs even on failure), and any leak still lands in a temp dir, never the worktree --
so the actual bug (worktree dirtiness) cannot recur regardless. The isolation flag is set in
run-tests.sh / the node invocation, checked at build time.
