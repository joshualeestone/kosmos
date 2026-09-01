'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox the data root so firstrun.state() touches no real store.
process.env.AGENT_WORKFORCE_DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-platgate-')), 'data');

const firstrun = require('./firstrun');
const platform = require('./platform');

/* kosmos: the macOS-only gate (Option A) wiring. Two wirings feed off
 * engine/platform.js: firstrun.state() reports the platform facts (for a future
 * gate screen), and server.js's real-start block arms live execution only on a
 * supported platform. The first is tested behaviorally here; the second is
 * source-asserted because its block (`if (require.main === module)`) is
 * deliberately not run by tests -- requiring the module must never arm live
 * execution -- exactly as update.test.js asserts the installer spawn shape from
 * source for the same reason. */

test('firstrun.state() carries the platform facts, matching platform.describe()', async () => {
  const s = await firstrun.state();
  assert.ok(s.platform, 'the state must carry a platform field for the gate screen');
  assert.deepEqual(s.platform, platform.describe(), 'the field is exactly platform.describe() (machine facts, no copy)');
  assert.equal(s.platform.supported, platform.isSupported(), 'supported agrees with the gate decision');
  // No user-facing copy leaked into the wire shape -- only machine facts.
  assert.deepEqual(Object.keys(s.platform).sort(), ['platform', 'supported']);
});

test('server.js arms live execution only under the isSupported() gate (source-asserted)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  // Anchor on the distinctive guard itself, not `if (require.main === module)`
  // (which appears several times). allowLiveExecution() is called in exactly one
  // place -- the real-start block -- so pinning the guard around it is exact.
  const g = src.indexOf('if (platformGate.isSupported()) {');
  assert.ok(g > -1, 'the platformGate.isSupported() guard is missing from server.js');
  const block = src.slice(g, g + 400);
  assert.match(block,
    /if \(platformGate\.isSupported\(\)\) \{\s*require\('\.\/engine\/live-execution'\)\.allowLiveExecution\(\);\s*\} else \{/,
    'allowLiveExecution() must be the if-arm of the isSupported guard, or a non-macOS board arms the Mac-only substrate');
  // The unsupported (else) arm must NOT arm live execution -- that would defeat the gate.
  const elseArm = block.slice(block.indexOf('} else {'));
  assert.doesNotMatch(elseArm, /allowLiveExecution\(\)/, 'the unsupported branch must not arm live execution');
  // And allowLiveExecution() is armed in ONLY this one place (no ungated call elsewhere).
  const calls = (src.match(/\.allowLiveExecution\(\)/g) || []).length;
  assert.equal(calls, 1, 'allowLiveExecution() is called somewhere other than the gated real-start block');
});

test('platformGate is required in server.js (the gate has its source of truth wired)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const platformGate = require\('\.\/engine\/platform'\)/,
    'server.js must require the platform gate module');
});
