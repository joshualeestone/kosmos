'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('./platform');

/* kosmos: the macOS-only gate (Option A). engine/platform.js is the single source
 * of truth for "does this OS run Kosmos". It is a PURE function taking the platform
 * as a parameter (like store.dataRootFor), so the unsupported OSes are testable on
 * this Mac without a Windows box. The server arms live execution only when
 * isSupported() is true; on any other OS the Mac-only substrate fails closed. */

test('macOS is supported; Windows and Linux are not (the whole point of the gate)', () => {
  assert.equal(platform.isSupported('darwin'), true, 'macOS must be supported');
  assert.equal(platform.isSupported('win32'), false, 'Windows is not supported today');
  assert.equal(platform.isSupported('linux'), false, 'Linux is not supported today');
});

test('an unknown/empty platform is not supported (fail closed, never open)', () => {
  assert.equal(platform.isSupported('aix'), false);
  assert.equal(platform.isSupported(''), false);
  assert.equal(platform.isSupported(undefined === undefined ? 'sunos' : ''), false);
});

test('isSupported() with no argument reads this process and agrees with SUPPORTED', () => {
  // Control that the default-parameter path is live (not just the explicit arg).
  // On any real host this equals membership of the actual process platform.
  assert.equal(platform.isSupported(), platform.SUPPORTED.includes(process.platform));
});

test('describe() returns machine facts only -- no user-facing copy', () => {
  assert.deepEqual(platform.describe('win32'), { platform: 'win32', supported: false });
  assert.deepEqual(platform.describe('darwin'), { platform: 'darwin', supported: true });
  const d = platform.describe();
  assert.equal(d.platform, process.platform, 'describe() defaults to this process');
  assert.equal(d.supported, platform.isSupported(), 'describe().supported agrees with isSupported()');
  // No copy: the object carries only machine facts, so a screen cannot accidentally
  // render a Baron-authored sentence where Josh's copy belongs.
  assert.deepEqual(Object.keys(d).sort(), ['platform', 'supported']);
});

test('SUPPORTED is frozen and is macOS only (adding one is a real port, not an entry)', () => {
  assert.deepEqual(platform.SUPPORTED, ['darwin']);
  assert.ok(Object.isFrozen(platform.SUPPORTED), 'SUPPORTED must be frozen so it cannot be widened at runtime');
});

test('the gate the server uses: it arms only on a supported platform (mirrors server.js)', () => {
  // The real-start block in server.js (inside `if (require.main === module)`) is
  // not unit-testable by design -- requiring the module must not arm live
  // execution. This pins the DECISION that block makes: arm iff isSupported.
  const armDecision = (plat) => platform.isSupported(plat); // what server.js branches on
  assert.equal(armDecision('darwin'), true, 'macOS arms live execution');
  assert.equal(armDecision('win32'), false, 'Windows leaves it unarmed -> substrate fails closed');
});
