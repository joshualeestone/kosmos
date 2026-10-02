'use strict';
/* #4588 ask 3: the persisted cap on how many Gemini (Antigravity) agents work at once. No limit by default, a closed
 * set of choices, and a bad file reads no limit (never a hold on every automatic message). Sandboxed data root before
 * the require, as heartbeat-setting.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-agycap-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const cap = require('./agycap-setting');

test.beforeEach(() => { fs.mkdirSync(nodePath.dirname(cap.FILE), { recursive: true }); });
test.afterEach(() => { fs.rmSync(cap.FILE, { force: true }); });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('sandbox: the setting file is inside this test\'s temp dir', () => {
  assert.ok(nodePath.resolve(cap.FILE).startsWith(nodePath.resolve(SANDBOX) + nodePath.sep), cap.FILE);
});

test('default: no limit (0), and an absent file is a clean read', () => {
  assert.deepEqual(cap.read(), { maxWorking: 0, ok: true });
});

test('the choices are exactly 0 (no limit) to 4', () => {
  assert.deepEqual([...cap.CHOICES], [0, 1, 2, 3, 4]);
});

test('a valid choice is saved and read back', () => {
  assert.deepEqual(cap.set({ maxWorking: 2 }), { ok: true });
  assert.deepEqual(cap.read(), { maxWorking: 2, ok: true });
  assert.deepEqual(cap.set({ maxWorking: 0 }), { ok: true });
  assert.deepEqual(cap.read(), { maxWorking: 0, ok: true });
});

test('a value outside the set, a string, or a missing field is refused and nothing is written', () => {
  for (const bad of [{ maxWorking: 5 }, { maxWorking: -1 }, { maxWorking: '2' }, { maxWorking: 1.5 }, {}, null]) {
    const r = cap.set(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.because, /must be one of 0, 1, 2, 3, 4/);
  }
  assert.equal(fs.existsSync(cap.FILE), false, 'a refused value wrote nothing');
});

test('a corrupt, non-object or out-of-set file reads NO LIMIT with ok false', () => {
  for (const body of ['{not json', '[1,2]', '{"maxWorking":9}', '"2"', 'null']) {
    fs.writeFileSync(cap.FILE, body);
    assert.deepEqual(cap.read(), { maxWorking: 0, ok: false }, body);
  }
});
