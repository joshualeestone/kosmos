'use strict';
/**
 * kosmos#7411 step 4: the line that names the running agents who need a restart to get a fix (engine/restartline.js).
 * The route is covered in server.restartline-7411.test.js.
 *
 *   node --test engine/restartline-7411.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-restartline-7411-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const rl = require('./restartline');
const RECORD = path.join(require('./store').ROOT, 'version-start.json');

const AT = Date.parse('2026-10-28T15:00:00.700Z');   // this version's first board start, with milliseconds
const SEC = 1000;
const fix = (version, title, restart = 'agents') => ({ version, title, line: 'x', ...(restart ? { restart } : {}) });
const NOTES = [fix('0.7.70', 'Old fix'), fix('0.7.72', 'Hooks fix'), fix('0.7.72', 'Plain note', null), fix('0.7.73', 'Newer than this build')];
const REC = { version: '0.7.72', previous: '0.7.71', at: AT, notNow: false };
const before = (name, label) => ({ name, label, startedAt: AT - 3600 * SEC });

test('#7411: names the running agents started before this version, for the marked notes since the last version', () => {
  const got = rl.lineFor({ record: REC, notes: NOTES, agents: [before('ada', 'Ada'), before('kai', 'Kai')] });
  assert.deepEqual(got, {
    version: '0.7.72',
    notes: [{ version: '0.7.72', title: 'Hooks fix' }],
    agents: [{ name: 'ada', label: 'Ada' }, { name: 'kai', label: 'Kai' }],
  });
});

test('#7411: a skipped version counts; notes at or before the last version, newer than this one, or unmarked do not', () => {
  const got = rl.lineFor({ record: { ...REC, previous: '0.7.69' }, notes: NOTES, agents: [before('ada', 'Ada')] });
  assert.deepEqual(got.notes.map((n) => n.title), ['Old fix', 'Hooks fix']);
  // Nothing marked in range: no line, however many agents are on old sessions.
  assert.equal(rl.lineFor({ record: REC, notes: [fix('0.7.72', 'Plain', null), fix('0.7.71', 'At the last version')], agents: [before('ada', 'Ada')] }), null);
});

test('#7411: only sessions that started before this version, read in whole seconds; unread starts are left out', () => {
  const sameSecond = Math.floor(AT / 1000) * 1000;   // tmux says the board's own second: started with it, not before
  const agents = [
    { name: 'old', label: 'Old', startedAt: sameSecond - SEC },
    { name: 'same', label: 'Same', startedAt: sameSecond },
    { name: 'new', label: 'New', startedAt: AT + 60 * SEC },
    { name: 'unread', label: 'Unread', startedAt: null },
  ];
  assert.deepEqual(rl.lineFor({ record: REC, notes: NOTES, agents }).agents, [{ name: 'old', label: 'Old' }]);
  // Nobody left on an old session: the line goes by itself.
  assert.equal(rl.lineFor({ record: REC, notes: NOTES, agents: agents.slice(1) }), null);
});

test('#7411: no line on a first install, after Not now, or with no record', () => {
  const agents = [before('ada', 'Ada')];
  assert.equal(rl.lineFor({ record: { ...REC, previous: null }, notes: NOTES, agents }), null);
  assert.equal(rl.lineFor({ record: { ...REC, notNow: true }, notes: NOTES, agents }), null);
  assert.equal(rl.lineFor({ record: null, notes: NOTES, agents }), null);
  // A label that is missing or blank falls back to the machine name.
  assert.deepEqual(rl.lineFor({ record: REC, notes: NOTES, agents: [{ name: 'ada', label: '  ', startedAt: AT - SEC * 10 }] }).agents,
    [{ name: 'ada', label: 'ada' }]);
});

test('#7411: atStart keeps the first start of a version and the version before it; Not now holds until the next update', () => {
  fs.rmSync(RECORD, { force: true });
  assert.deepEqual(rl.atStart('0.7.71', 1000), { version: '0.7.71', previous: null, at: 1000, notNow: false }, 'a first sight has no previous');
  assert.equal(rl.atStart('0.7.71', 5000).at, 1000, 'a restart on the same version moved its first start');
  assert.deepEqual(rl.atStart('0.7.72', 9000), { version: '0.7.72', previous: '0.7.71', at: 9000, notNow: false });
  assert.equal(rl.notNow('0.7.71'), false, 'an old page hid a newer update\'s line');
  assert.equal(rl.read().notNow, false);
  assert.equal(rl.notNow('0.7.72'), true);
  assert.equal(rl.read().notNow, true);
  assert.equal(rl.atStart('0.7.72', 12000).notNow, true, 'a restart on the same version brought a hidden line back');
  assert.deepEqual(rl.atStart('0.7.73', 20000), { version: '0.7.73', previous: '0.7.72', at: 20000, notNow: false }, 'the next update stayed hidden');
  // A rollback is not an update: no previous, so no line; going up again counts from the version rolled back to.
  assert.deepEqual(rl.atStart('0.7.72', 30000), { version: '0.7.72', previous: null, at: 30000, notNow: false }, 'a rollback counted as an update');
  assert.deepEqual(rl.atStart('0.7.73', 40000), { version: '0.7.73', previous: '0.7.72', at: 40000, notNow: false });
  assert.equal(rl.atStart('not a version', 1), null);
  assert.equal(rl.read().version, '0.7.73', 'a bad version overwrote the record');
});
