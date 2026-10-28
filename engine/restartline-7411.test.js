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

const HOUR = 3600 * 1000;
const T0 = Date.parse('2026-10-20T15:00:00Z');                     // installed on 0.7.70
const AT = Date.parse('2026-10-28T15:00:00.700Z');                  // updated to 0.7.72, with milliseconds
const fix = (version, title, restart = 'agents') => ({ version, title, line: 'x', ...(restart ? { restart } : {}) });
const NOTES = [fix('0.7.70', 'Install-time fix'), fix('0.7.72', 'Hooks fix'), fix('0.7.72', 'Plain note', null), fix('0.7.73', 'Newer than this build')];
const rec = (history, notNow = false) => ({ version: history[history.length - 1].version, history, notNow });
const REC = rec([{ version: '0.7.70', at: T0 }, { version: '0.7.72', at: AT }]);
const before = (name, label, at = AT - HOUR) => ({ name, label, startedAt: at });

test('#7411: names the running agents started before a marked fix reached this computer', () => {
  assert.deepEqual(rl.lineFor({ record: REC, notes: NOTES, agents: [before('ada', 'Ada'), before('kai', 'Kai')] }), {
    version: '0.7.72',
    notes: [{ version: '0.7.72', title: 'Hooks fix' }],
    agents: [{ name: 'ada', label: 'Ada' }, { name: 'kai', label: 'Kai' }],
  });
  // A fix the computer had from its first recorded version, newer than this build, or unmarked: never said.
  assert.equal(rl.lineFor({ record: REC, notes: [fix('0.7.70', 'A'), fix('0.7.73', 'B'), fix('0.7.72', 'C', null)], agents: [before('ada', 'Ada', T0 - HOUR)] }), null);
});

test('#7411: a fix from an earlier update is not forgotten when a later update lands before the agents restart', () => {
  // 0.7.71 brought a marked fix; 0.7.72 brought nothing marked. Agents from before 0.7.71 still lack it.
  const T1 = AT - 24 * HOUR;
  const r = rec([{ version: '0.7.70', at: T0 }, { version: '0.7.71', at: T1 }, { version: '0.7.72', at: AT }]);
  const got = rl.lineFor({ record: r, notes: [fix('0.7.71', 'Older fix')], agents: [before('old', 'Old', T1 - HOUR), before('mid', 'Mid', T1 + HOUR)] });
  assert.deepEqual(got.agents, [{ name: 'old', label: 'Old' }], 'an agent started after 0.7.71 was named for its fix');
  assert.deepEqual(got.notes, [{ version: '0.7.71', title: 'Older fix' }]);
  // With a marked fix in each update, the line lists only the fixes the named agents lack.
  const both = rl.lineFor({ record: r, notes: [fix('0.7.71', 'Older fix'), fix('0.7.72', 'Newer fix')], agents: [before('mid', 'Mid', T1 + HOUR)] });
  assert.deepEqual(both.notes, [{ version: '0.7.72', title: 'Newer fix' }]);
});

test('#7411: a rollback below a fix and back up counts from the update back up', () => {
  const R = AT - 12 * HOUR, U = AT - 6 * HOUR;
  const r = rec([{ version: '0.7.70', at: T0 }, { version: '0.7.72', at: AT - 24 * HOUR }, { version: '0.7.71', at: R }, { version: '0.7.72', at: U }]);
  // An agent started during the rollback ran without the fix: it is named. One started after the update back up is not.
  const got = rl.lineFor({ record: r, notes: [fix('0.7.72', 'Hooks fix')], agents: [before('during', 'During', R + HOUR), before('after', 'After', U + HOUR)] });
  assert.deepEqual(got.agents, [{ name: 'during', label: 'During' }]);
  // Rolled back below the fix and still there: the running version does not carry it, so nothing is said.
  const down = rec([{ version: '0.7.70', at: T0 }, { version: '0.7.72', at: R }, { version: '0.7.71', at: U }]);
  assert.equal(rl.lineFor({ record: down, notes: [fix('0.7.72', 'Hooks fix')], agents: [before('ada', 'Ada', T0)] }), null);
});

test('#7411: session starts are read in whole seconds; unread starts are left out', () => {
  const sameSecond = Math.floor(AT / 1000) * 1000;   // tmux says the board's own second: started with it, not before
  const agents = [
    { name: 'old', label: 'Old', startedAt: sameSecond - 1000 },
    { name: 'same', label: 'Same', startedAt: sameSecond },
    { name: 'new', label: 'New', startedAt: AT + 60000 },
    { name: 'unread', label: 'Unread', startedAt: null },
  ];
  assert.deepEqual(rl.lineFor({ record: REC, notes: NOTES, agents }).agents, [{ name: 'old', label: 'Old' }]);
  assert.equal(rl.lineFor({ record: REC, notes: NOTES, agents: agents.slice(1) }), null, 'the line did not go once nobody lacked the fix');
});

test('#7411: no line on a first install, after Not now, or with no record; a blank label falls back to the name', () => {
  const agents = [before('ada', 'Ada', T0 - HOUR)];
  assert.equal(rl.lineFor({ record: rec([{ version: '0.7.72', at: AT }]), notes: NOTES, agents }), null);
  assert.equal(rl.lineFor({ record: rec(REC.history, true), notes: NOTES, agents }), null);
  assert.equal(rl.lineFor({ record: null, notes: NOTES, agents }), null);
  assert.deepEqual(rl.lineFor({ record: REC, notes: NOTES, agents: [{ name: 'ada', label: '  ', startedAt: AT - 10000 }] }).agents, [{ name: 'ada', label: 'ada' }]);
});

test('#7411: atStart keeps each version\'s first start; Not now holds until the next update', () => {
  fs.rmSync(RECORD, { force: true });
  assert.deepEqual(rl.atStart('0.7.71', 1000).history, [{ version: '0.7.71', at: 1000 }]);
  assert.equal(rl.atStart('0.7.71', 5000).history.length, 1, 'a restart on the same version added an entry');
  assert.deepEqual(rl.atStart('0.7.72', 9000).history, [{ version: '0.7.71', at: 1000 }, { version: '0.7.72', at: 9000 }]);
  assert.equal(rl.notNow('0.7.71'), false, 'an old page hid a newer update\'s line');
  assert.equal(rl.read().notNow, false);
  assert.equal(rl.notNow('0.7.72'), true);
  assert.equal(rl.read().notNow, true);
  assert.equal(rl.atStart('0.7.72', 12000).notNow, true, 'a restart on the same version brought a hidden line back');
  assert.equal(rl.atStart('0.7.73', 20000).notNow, false, 'the next update stayed hidden');
  assert.equal(rl.atStart('not a version', 1), null);
  assert.equal(rl.read().version, '0.7.73', 'a bad version overwrote the record');
  for (let i = 0; i < 60; i++) rl.atStart('1.0.' + i, 30000 + i);
  assert.equal(rl.read().history.length, 50, 'the history grew without bound');
});
