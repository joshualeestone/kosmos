'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const store = require('./store');
const create = require('./create');

const REPO = path.join(__dirname, '..');

/**
 * #570 made `store.js`'s data root platform-aware and did not touch
 * `create.js`'s, so for a few hours the product had TWO answers to "where does
 * this product keep its files" and only one of them knew what Windows is.
 *
 * `create.js`'s own comment has said since it was written that there should be
 * one answer "rather than a second convention introduced by whoever needed a
 * directory next". These pin that it is now true.
 *
 * ⚠️ THE GUARD BELOW ASSERTS THE POSITIVE WIRING, NOT THE ABSENCE OF A STRING.
 * An earlier version of this check searched for the literal and was defeated by
 * four plausible re-spellings that all resolve correctly on a Mac and break
 * Windows: a line-wrapped `path.join(`, column-aligned quotes, a hoisted
 * `const LIB_DIR`, and `'Application' + ' Support'`. It also went red on a
 * doc SENTENCE mentioning the folder, which is a false accusation.
 * `store.dataRootFor(` is what must actually be true and no re-spelling fakes it.
 */

test('create and store give ONE answer for the data root', () => {
  assert.equal(create.supportDir(), store.ROOT);
});

test('create.js routes through store.dataRootFor rather than building a path', () => {
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  assert.ok(src.length > 1000, 'create.js did not read; floor not met');
  assert.match(src, /store\.dataRootFor\s*\(/,
    'create.js must delegate to store.dataRootFor, or the two sites can diverge again');
});

test('supportDir is exported as a FUNCTION, which destructuring cannot freeze', () => {
  // #1432: `const { SUPPORT_DIR } = require(...)` on a getter evaluates once and
  // silently pins the real machine even with the seam set afterwards.
  // tools/check-frozen-roots.js:25 names create.SUPPORT_DIR by that exact name.
  assert.equal(typeof create.supportDir, 'function');
  assert.equal(create.SUPPORT_DIR, undefined, 'the frozen-able name must not come back');
});

/**
 * The #1432 property, end to end. Runs in a CHILD so the seam can be set after
 * this module tree is already loaded.
 *
 * ⚠️ `cwd` IS PINNED TO THE REPO ROOT. Without it this passes from the repo
 * root and dies from `engine/` with "Cannot find module", rendered under a
 * heading about the data root -- the most alarming possible message for this
 * change, arriving from an entirely unrelated cause.
 */
function inChild(expr, env) {
  return execFileSync(process.execPath, ['-e', expr], {
    cwd: REPO,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  }).trim();
}

test('supportDir stays lazy: a seam set AFTER require is honoured', () => {
  const got = inChild(
    "const c = require('./engine/create');" +
    "process.env.AGENT_WORKFORCE_DATA = '/tmp/seam-570';" +
    "process.stdout.write(c.supportDir());",
    { AGENT_WORKFORCE_DATA: undefined }
  );
  assert.equal(got, path.join('/tmp/seam-570', 'AgentWorkforce'));
});

test('the sandbox path is byte-identical to what it replaced', () => {
  // The branch this delegation replaced did path.join(DATA, 'AgentWorkforce').
  // dataRootFor does path.join(DATA, APP) with APP = 'AgentWorkforce'.
  const got = inChild(
    "process.stdout.write(require('./engine/create').supportDir());",
    { AGENT_WORKFORCE_DATA: '/tmp/sandbox-570' }
  );
  assert.equal(got, path.join('/tmp/sandbox-570', 'AgentWorkforce'));
});

test('on Windows both sites land in AppData, not in a Library folder', () => {
  // Asked of dataRootFor directly, because process.platform cannot be set.
  // This is the defect: on Windows the old create.js happily created a literal
  // "Library\\Application Support" folder. MEASURED on a real Windows Server
  // 2022 box on 2026-08-29: that folder existed from an install on 08-25,
  // holding bin/agent-supervisor.sh.
  const got = store.dataRootFor('win32', 'C:\\Users\\someone', {});
  assert.ok(!got.includes('Library'), `must not contain Library, got ${got}`);
  assert.ok(got.includes('AppData'), `must be under AppData, got ${got}`);
});

test('darwin is unchanged, which is the property that must never move', () => {
  const home = '/Users/someone';
  // Written against the literal expression create.js used before delegating,
  // never against dataRootFor, or this agrees with any bug it has.
  const before = path.join(home, 'Library', 'Application Support', 'AgentWorkforce');
  assert.equal(store.dataRootFor('darwin', home, {}), before);
});
