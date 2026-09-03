'use strict';

/**
 * Every node *.test.js the repo carries is somewhere tools/run-tests.sh actually
 * runs, and the runner keeps its coverage guard.
 *
 * 🛑 WHY. kosmos#1934: `origin/main` went red on `engine.reachable.test.js` and
 * stayed red under FOUR merges with green PR checks, because a pre-merge
 * validation globbed `engine/*.test.js` -- a SLASH -- and the red file is at the
 * ROOT, `engine.reachable.test.js`, a DOT. No `engine/*` glob can match it. The
 * naming convention uses dots as a pseudo-namespace at root (engine.reachable,
 * install.banner, cli.help-flag) WHILE a real engine/ directory also exists, so
 * `engine.X` (root) and `engine/X` (dir) read identically and a path glob quietly
 * runs a fraction. A glob matching a subset still exits 0 with a healthy tally.
 *
 * ⭐ THE DURABLE HALF, the sibling of tools.every-test-runs.test.js (which does
 * this for tools/test-*.sh). run-tests.sh globs exactly two roots: the repo root
 * and engine/. This pins that EVERY *.test.js lives in one of those two, so a
 * suite dropped into a new subdirectory fails HERE -- at suite time, named -- long
 * before it can sit unrun and green. And it pins that run-tests.sh keeps the
 * coverage assertion that refuses to run a subset, so that runtime guard cannot be
 * quietly deleted.
 *
 *   node --test tools.all-node-tests-considered-1934.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* Every *.test.js in the tree, node_modules pruned, as repo-relative POSIX paths. */
function allNodeTests(dir = '.', out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) allNodeTests(p, out);
    else if (/\.test\.js$/.test(ent.name)) out.push(p.replace(/^\.\//, ''));
  }
  return out;
}

/* 🔑 A FLOOR ON THE POPULATION, the same reason tools.every-test-runs.test.js has
   one: if the walk came back near-empty this file would pass by finding nothing,
   which is the failure mode it exists to prevent. */
test('the instrument is reading the whole tree', () => {
  const found = allNodeTests();
  assert.ok(found.length >= 300,
    `only ${found.length} *.test.js found; the tree walk looks broken, and the coverage assertion below would pass for the wrong reason`);
});

test('every *.test.js lives where run-tests.sh globs it (repo root or engine/)', () => {
  /* run-tests.sh globs `engine/*.test.js *.test.js`: exactly two roots. A file is
     covered iff it is at the repo root (no slash) or directly under engine/. A file
     anywhere else is globbed by neither and would run only if someone remembered to
     name it -- the silent-subset trap #1934 is about. */
  const stray = allNodeTests().filter((f) => {
    const atRoot = !f.includes('/');
    const inEngineDir = /^engine\/[^/]+\.test\.js$/.test(f);
    return !(atRoot || inEngineDir);
  });
  assert.deepEqual(stray, [],
    `these *.test.js are in neither location tools/run-tests.sh globs (repo root or engine/), so the `
    + `suite would not run them and nothing would say so: ${stray.join(', ')}. Move them to the root or `
    + `into engine/, OR widen the glob AND the coverage assertion in tools/run-tests.sh to cover the new `
    + `directory. (kosmos#1934: a path glob that matches a subset still exits 0 green.)`);
});

test('run-tests.sh keeps the coverage assertion that refuses to run a subset (#1934)', () => {
  /* The runtime guard is the half that runs EVERY time; this pins that it is still
     there, so it cannot be silently dropped back to a bare glob. Checked by the
     shape of the guard, not by a comment, so a reworded comment cannot satisfy it. */
  const runner = fs.readFileSync('tools/run-tests.sh', 'utf8');
  assert.match(runner, /_considered/,
    'run-tests.sh no longer gathers the test set into a counted variable; the #1934 coverage guard is gone');
  assert.match(runner, /-ne\s+"\$_exist"/,
    'run-tests.sh no longer refuses on a considered-vs-exist mismatch (-ne, both directions); a narrowed glob or a find/glob discrepancy would pass green again (#1934)');
  assert.match(runner, /node --test "\$\{KOSMOS_TEST_FILES\[@\]\}"/,
    'run-tests.sh no longer runs the SAME counted set it asserted on, so the count and the run can drift apart (#1934)');
});
