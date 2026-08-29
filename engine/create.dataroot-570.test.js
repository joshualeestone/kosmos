'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/* ⚠️ REQUIRED WITHOUT SANDBOXING FIRST, against run-tests.sh's usual rule, and
   deliberately: this file's subject IS the real resolved path, so sandboxing
   would hide the thing under test. Measured safe: requiring `store` and
   `create` performs no mkdir and no write (0 files touched; control -- creating
   one probe file made the same sweep return 1). */
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

/**
 * ⚠️ ONE HELPER, because two copies of this regex meant a formatting change
 * produced `TypeError: Cannot read properties of null` under a heading about
 * the data root -- a confusing message from an unrelated cause, which is the
 * exact failure the `cwd` comment further down warns about.
 */
function supportDirBody() {
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  assert.ok(src.length > 100000, `create.js read short (${src.length} bytes); floor not met`);
  const m = /\nfunction supportDir\(\)\s*\{([\s\S]*?)\n\}/.exec(src);
  assert.ok(m, 'supportDir() not found in create.js by the source heuristic; if it was reformatted or made an arrow, this check needs updating and is NOT reporting a real defect');
  return m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

/**
 * 🛑 THIS IS A TEXT HEURISTIC, NOT A PROOF OF DELEGATION, AND I HAVE NOW
 * CLAIMED OTHERWISE THREE TIMES. Measured defeats of THIS version, each
 * leaving macOS byte-identical and Windows broken with every other test green:
 * a nested block whose `}` sits at column 0 truncates the capture; a doc
 * comment containing the text `function supportDir() {` above the real one; a
 * `macDataRoot()` helper plus a dead call; and a hoisted
 * `const APPSUP = ['Library','Application Support']`.
 *
 * ⇒ Scoping to the body NARROWED the class. It did not close it. The test
 * below this one is what actually observes the call.
 */
test('source heuristic: supportDir mentions the resolver and no literal path', () => {
  const code = supportDirBody();
  assert.match(code, /\bdataRootFor\s*\(/,
    'supportDir must reach dataRootFor, or the two sites can diverge again');
  assert.doesNotMatch(code, /Application Support|Library/,
    'supportDir builds the path itself; it must delegate');
});

/**
 * ✅ THE ONE THAT ACTUALLY PROVES DELEGATION, BY OBSERVING THE CALL.
 *
 * Stub `store.dataRootFor`, call `create.supportDir()`, and check the sentinel
 * came back. **No re-spelling, refactor, decoy comment or hoisted const can
 * satisfy this without actually calling the function**, because it is not
 * reading text at all.
 *
 * Measured: RED on all five source-level defeats above; GREEN on the
 * unmodified tree AND on five legitimate re-spellings (arrow, function
 * expression, `supportDir ()`, brace-on-next-line, in-body destructure), three
 * of which the text heuristic wrongly rejects.
 *
 * ⚠️ SHARED LIMITATION, NOT A REGRESSION: neither this nor the heuristic
 * catches a module-top-level `const { dataRootFor } = store`, because that
 * captures the reference before this stub replaces it. Named rather than left
 * for somebody to find.
 */
test('BEHAVIOUR: supportDir actually calls store.dataRootFor, observed', () => {
  const real = store.dataRootFor;
  let seen = null;
  try {
    store.dataRootFor = (...args) => { seen = args; return '/SENTINEL-570'; };
    const got = create.supportDir();
    assert.equal(got, '/SENTINEL-570',
      'supportDir did not return what store.dataRootFor returned, so it is not delegating');
    assert.ok(seen, 'store.dataRootFor was never called');
    assert.equal(seen[0], process.platform, 'the platform must be passed through, or Windows gets the mac answer');
  } finally {
    store.dataRootFor = real;
  }
  assert.equal(store.dataRootFor, real, 'the stub must be put back or later tests read a fake');
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
  assert.match(supportDirBody(), /\bdataRootFor\s*\(/,
    'create must reach this resolver for the assertion below to be about create');
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
