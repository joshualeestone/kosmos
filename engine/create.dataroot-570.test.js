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
 * ⚠️ THE GUARD BELOW IS SCOPED TO `supportDir`'s BODY, WITH COMMENTS STRIPPED,
 * AND IT TOOK THREE TRIES TO GET THERE.
 *
 * 🛑 I PREVIOUSLY WROTE HERE THAT "no re-spelling fakes it". THAT WAS FALSE and
 * a reviewer measured three fakes against it in minutes: a COMMENT naming
 * `store.dataRootFor(`, a dead `if (false) return store.dataRootFor(...)`, and a
 * mention inside an unrelated function 150KB away. All three left the literal in
 * place and the suite green, because the regex scanned the whole 153KB file.
 *
 * ⚠️ AND IT ACCUSED CORRECT CODE. `const { dataRootFor } = store` and
 * `const s = store; s.dataRootFor(...)` are both real delegation and both went
 * RED. So it had false negatives AND false positives at once.
 *
 * ⇒ Scoping to the function body closes both: the positive arm tolerates
 * aliasing, and the negative arm can only see the code that actually runs.
 */

/**
 * ⚠️ NAMED FOR WHAT IT ACTUALLY CHECKS. It used to be called "create and store
 * give ONE answer", which is FALSE: `store.ROOT` is frozen at require time
 * (tracked debt in check-frozen-roots' KNOWN map) while `supportDir()` is lazy,
 * so with the seam set after require they legitimately DIFFER -- which is the
 * very scenario the laziness test below pins.
 *
 * 📌 It also never went red on any value perturbation, because both sides derive
 * from the same function. It is a wiring assertion, not a value one, and the
 * body-scoped guard above is what actually catches this card's defect.
 */
test('create reaches the same resolver store built ROOT from', () => {
  assert.equal(create.supportDir(), store.ROOT,
    'with env unchanged since require, the lazy and frozen forms must agree');
});

test('supportDir DELEGATES and does not build a path, checked on its body alone', () => {
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  // C2: the old floor of 1000 was 0.65% of a 153KB file, so almost any
  // truncated read passed it. This is a real floor.
  assert.ok(src.length > 100000, `create.js read short (${src.length} bytes); floor not met`);

  const m = /\nfunction supportDir\(\)\s*\{([\s\S]*?)\n\}/.exec(src);
  assert.ok(m, 'supportDir() not found in create.js; this guard is not looking at anything');

  // Comments stripped: a comment NAMING dataRootFor must not satisfy the
  // positive arm, and a comment mentioning the folder must not trip the
  // negative one. Measured: both happened.
  const code = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

  // Positive arm, deliberately loose about HOW it is reached, so
  // `const { dataRootFor } = store` and `s.dataRootFor(...)` are not accused.
  assert.match(code, /\bdataRootFor\s*\(/,
    'supportDir must reach dataRootFor, or the two sites can diverge again');

  // Negative arm, on the body only. This is what catches a revert that leaves
  // an explanatory comment naming the function behind, which is the likeliest
  // real-world path.
  assert.doesNotMatch(code, /Application Support|Library/,
    'supportDir builds the path itself; it must delegate');
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

/**
 * ⚠️ ASKS `create` TOO, NOT ONLY `store`. Named "both sites" before and asserted
 * only `store.dataRootFor`, so a full revert of create.js left it green. A test
 * whose name claims coverage it does not have is worse than no test.
 */
test('on Windows the resolver create uses lands in AppData, not a Library folder', () => {
  // create's own delegation, proven by the guard above, is what makes this
  // statement about create rather than only about store.
  assert.match(
    fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8')
      .match(/\nfunction supportDir\(\)\s*\{([\s\S]*?)\n\}/)[1]
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, ''),
    /\bdataRootFor\s*\(/, 'create must reach this resolver for the assertion below to be about create');
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
