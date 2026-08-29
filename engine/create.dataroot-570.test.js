'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
 * ⚠️ A DISCLAIMER I WROTE HERE WAS FALSE AND IS DELETED. It said neither guard
 * catches a module-top-level `const { dataRootFor } = store`. Measured by a
 * reviewer: planting exactly that goes RED, on this test, because the stub's
 * SENTINEL RETURN VALUE fails even when the stub call itself is not observed.
 * ⇒ The guard was STRONGER than my comment claimed. An over-broad disclaimer is
 * a wrong claim wearing humility, and it invites somebody to build coverage for
 * a gap that does not exist.
 * 📌 What IS true, as a deliberate trade rather than a blind spot: that shape is
 * genuine delegation and this test rejects it, because rejecting it preserves
 * the seam.
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
 * ✅ THE PLATFORM x ENVIRONMENT MATRIX, AND IT REPLACES THREE WEAKER GUARDS.
 *
 * 🛑 ITS PREDECESSOR ASSERTED TWO SUBSTRINGS (no "Library", yes "AppData") AND
 * WAS DEFEATED FOUR WAYS, each leaving all nine tests green. Measured by a
 * reviewer, and the first is the shape somebody writes while fixing a Windows
 * bug locally:
 *     if (platform === 'win32') return path.join(homeDir(),'AppData','Roaming',APP)
 *     dataRootFor(platform, homeDir(), platform === 'win32' ? {} : process.env)
 *     dataRootFor(platform, platform === 'win32' ? 'C:\Users\Default' : homeDir(), ...)
 *     ...the same with 'Local' instead of 'Roaming'
 *
 * With the first planted, ON WINDOWS the sandbox seam is DEAD (tests would write
 * to a real store) and a redirected APPDATA is ignored. That is the
 * two-spellings defect this branch exists to remove, reintroduced one branch
 * over.
 *
 * ⭐ AND THE CLASS, WHICH IS THE PART I KEEP GETTING WRONG. My previous commit
 * was titled "both guards were blind to a platform-conditional" and it FIXED
 * THE INSTANCE, NOT THE CLASS. A substring check cannot see a value that is
 * wrong in a way which still contains the right substring.
 *
 * ⚠️ THE ENVIRONMENT MUST VARY, AND THAT IS NOT OBVIOUS. The reviewer's first
 * attempt asserted equality under the AMBIENT env only and TWO OF THE FOUR
 * ATTACKS STAYED GREEN, because on a Mac with APPDATA and AGENT_WORKFORCE_DATA
 * both unset, a hardcoded `AppData\Roaming` spelling EQUALS the resolver by
 * coincidence. A matrix with one axis is not a matrix.
 */
test('supportDir EQUALS the resolver across every platform and environment', () => {
  const ENVS = [
    {},
    { APPDATA: 'D:\\Redirected\\AppData\\Roaming' },
    { AGENT_WORKFORCE_DATA: '/tmp/seam-matrix' },
    { APPDATA: 'D:\\R', AGENT_WORKFORCE_DATA: '/tmp/seam-matrix' },
  ];
  const PLATFORMS = ['darwin', 'win32', 'linux', 'freebsd'];
  const KEYS = ['APPDATA', 'AGENT_WORKFORCE_DATA', 'LOCALAPPDATA'];
  let checked = 0;

  for (const overlay of ENVS) {
    const saved = {};
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    Object.assign(process.env, overlay);
    try {
      for (const plat of PLATFORMS) {
        assert.equal(
          create.supportDir(plat),
          store.dataRootFor(plat, os.homedir(), process.env),
          `supportDir disagrees with the resolver for ${plat} under ${JSON.stringify(overlay)}`
        );
        checked += 1;
      }
    } finally {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  }
  // A floor: an empty matrix would pass by checking nothing at all.
  assert.equal(checked, ENVS.length * PLATFORMS.length,
    'the matrix did not run every combination, so a green here proves less than it looks');
});


test('darwin is unchanged, which is the property that must never move', () => {
  const home = '/Users/someone';
  // Written against the literal expression create.js used before delegating,
  // never against dataRootFor, or this agrees with any bug it has.
  const before = path.join(home, 'Library', 'Application Support', 'AgentWorkforce');
  assert.equal(store.dataRootFor('darwin', home, {}), before);
});
