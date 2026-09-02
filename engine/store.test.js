'use strict';

/**
 * Tests for the store.
 *
 * This is the file that decides where uploaded bytes land, so it is the one
 * place in the codebase where being wrong writes to somewhere it should not.
 * It was written quickly and verified by hand once; these pin the behaviour
 * that hand-check confirmed.
 *
 *   node --test engine/store.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { safeKey, ALLOWED_IMAGES, AVATARS } = require('./store');
/* ⚠️ ALSO REQUIRED AS A NAMESPACE, and the two are not interchangeable.
   `ROOT`/`AVATARS`/`PROFILES` are lazy getters (#1443); destructuring one
   evaluates it ONCE, right here, and re-freezes it. The line above keeps doing
   that deliberately - the tests below it are path arithmetic and want a fixed
   value - while the late-seam test at the bottom of this file needs the live
   property, so it reads through `store.` instead. */
const store = require('./store');
const fs = require('node:fs');
const os = require('node:os');

// ---------------------------------------------------------------------------
// Name sanitising -- the security-relevant part
// ---------------------------------------------------------------------------

test('traversal sequences cannot escape the store', () => {
  // Verified by hand once: ../../evil resolved inside the store rather than
  // outside it. This pins that, because "the response said ok" was not
  // evidence of where the bytes actually went.
  for (const attack of ['../../evil', '../../../etc/passwd', '..%2F..%2Fevil', './../x']) {
    const key = safeKey(attack);
    assert.ok(!key.includes('/'), `slash survived in ${attack} -> ${key}`);
    assert.ok(!key.includes('.'), `dot survived in ${attack} -> ${key}`);
    const resolved = path.resolve(AVATARS, key + '.png');
    assert.ok(resolved.startsWith(path.resolve(AVATARS) + path.sep),
      `${attack} resolved outside the store: ${resolved}`);
  }
});

test('an absolute path cannot be smuggled in as a name', () => {
  const resolved = path.resolve(AVATARS, safeKey('/etc/passwd') + '.png');
  assert.ok(resolved.startsWith(path.resolve(AVATARS) + path.sep));
});

test('a name that sanitises to nothing is refused rather than silently allowed', () => {
  // '...' becoming '' would otherwise write to the store directory itself.
  for (const empty of ['...', '///', '../..', '']) {
    assert.throws(() => safeKey(empty), /invalid agent name/,
      `${JSON.stringify(empty)} should be refused`);
  }
});

test('names are case-folded so one agent cannot own two avatars', () => {
  assert.equal(safeKey('Angel'), safeKey('angel'));
  assert.equal(safeKey('ANGEL'), 'angel');
});

test('ordinary names survive intact', () => {
  assert.equal(safeKey('angel'), 'angel');
  assert.equal(safeKey('casey-jones'), 'casey-jones');
  assert.equal(safeKey('agent_2'), 'agent_2');
});

// ---------------------------------------------------------------------------
// Upload validation
// ---------------------------------------------------------------------------

test('only image types the page can actually render are accepted', () => {
  // A file the browser cannot display looks identical to an upload that
  // silently failed, which is the worse of the two outcomes.
  for (const good of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    assert.ok(ALLOWED_IMAGES[good], `${good} should be allowed`);
  }
  for (const bad of ['application/zip', 'text/html', 'image/svg+xml', 'application/octet-stream', '']) {
    assert.ok(!ALLOWED_IMAGES[bad], `${bad} should not be allowed`);
  }
});

test('svg is deliberately excluded', () => {
  // SVG is a document format that can carry script. It renders like an image
  // and behaves like a web page, which is not a trade worth making for an
  // avatar.
  assert.ok(!ALLOWED_IMAGES['image/svg+xml']);
});

test('every allowed type maps to a real file extension', () => {
  for (const [type, ext] of Object.entries(ALLOWED_IMAGES)) {
    assert.match(ext, /^\.[a-z]+$/, `${type} has a suspect extension: ${ext}`);
  }
});

// ---------------------------------------------------------------------------
// #1443: the data root is resolved PER CALL, not frozen at require time
// ---------------------------------------------------------------------------

/**
 * 🛑 WHY THIS EXISTS. `ROOT`, `AVATARS` and `PROFILES` were module-level
 * consts. A caller that set `AGENT_WORKFORCE_DATA` AFTER requiring this module
 * read straight past the seam and got the operator's REAL Application Support
 * directory - the place avatars and profiles are written. Same class as
 * `accounts.HOME` (#1419) and the seven modules in #1432, and it was carried as
 * named debt in `tools/check-frozen-roots.js` until this card.
 *
 * ⭐ MEASURED, three arms:
 *   pre-fix,  seam set after require  -> /Users/<operator>/Library/Application Support/AgentWorkforce
 *   post-fix, seam set after require  -> the fixture, all three paths
 *   post-fix, seam set before require -> the fixture (every other test file here
 *                                        and in engine/ already covers this arm)
 *
 * 📌 ARM 2 IS THE ONE THAT CATCHES A PARTIAL FIX. `AVATARS` and `PROFILES` were
 * derived from `ROOT` at module level, so making only `ROOT` lazy leaves both of
 * them pointing at the real machine while arm 1 passes and looks like a fix.
 */
test('#1443: ROOT, AVATARS and PROFILES follow a data root set AFTER require', () => {
  const late = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-store-late-'));
  const before = process.env.AGENT_WORKFORCE_DATA;
  process.env.AGENT_WORKFORCE_DATA = late;
  try {
    // arm 1: the root itself
    assert.ok(store.ROOT.startsWith(late),
      `store.ROOT did not follow a seam set after require, so a caller that sandboxes late writes to the real machine: ${store.ROOT}`);

    // arm 2: the two derived paths, which a ROOT-only fix leaves behind
    assert.ok(store.AVATARS.startsWith(late),
      `store.AVATARS is still frozen while ROOT followed: the derivation re-froze it and uploaded avatars land on the real machine: ${store.AVATARS}`);
    assert.ok(store.PROFILES.startsWith(late),
      `store.PROFILES is still frozen while ROOT followed: ${store.PROFILES}`);

    // arm 3: nothing from the operator's real store leaked in. Shape-based
    // rather than naming a real path, so it stays true on any machine.
    for (const [name, v] of [['ROOT', store.ROOT], ['AVATARS', store.AVATARS], ['PROFILES', store.PROFILES]]) {
      assert.ok(!v.includes('Library/Application Support'),
        `store.${name} resolved into the operator's real Application Support directory: ${v}`);
    }
  } finally {
    if (before === undefined) delete process.env.AGENT_WORKFORCE_DATA;
    else process.env.AGENT_WORKFORCE_DATA = before;
    fs.rmSync(late, { recursive: true, force: true });
  }
});
