const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const update = require('./update');

// #6149 point 8: updateRefused() reads the record setup.sh leaves at <installedRoot>/logs/update-refused when an
// update refuses before removing anything, and lastAttempt() attaches it to a FAILED attempt it explains.

function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-6149-'));
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  update.setInstalledRoot(() => root);
  update.resetCache();
  try { return fn(root); } finally { update.setInstalledRoot(null); update.resetCache(); }
}
const writeRefused = (root, body) => fs.writeFileSync(path.join(root, 'logs', 'update-refused'), body);
const writeStatus = (root, code, startedAt) => fs.writeFileSync(path.join(root, 'logs', 'install.status'), code + ' ' + startedAt + '\n');

test('updateRefused: a locked refusal reads why, at, parts and ts', () => {
  withRoot((root) => {
    writeRefused(root, 'why=locked\nat=/k/app/engine/x.js\nts=2026-10-14T13:00:05Z\npart=app\npart=runtime\n');
    assert.deepEqual(update.updateRefused(), { why: 'locked', at: '/k/app/engine/x.js', parts: ['app', 'runtime'],
      paths: [path.join(root, 'app'), path.join(root, 'runtime')], ts: '2026-10-14T13:00:05Z' });
  });
});

test('updateRefused: a permissions refusal has no parts', () => {
  withRoot((root) => {
    writeRefused(root, 'why=permissions\nat=/k/app/engine\nts=2026-10-14T13:00:05Z\n');
    assert.deepEqual(update.updateRefused(), { why: 'permissions', at: '/k/app/engine', parts: [], paths: [], ts: '2026-10-14T13:00:05Z' });
  });
});

test('updateRefused: no record is null (the control: a healthy install claims nothing)', () => {
  withRoot(() => { assert.equal(update.updateRefused(), null); });
});

test('updateRefused: damage is null (an unknown why, a missing at, a key written twice)', () => {
  withRoot((root) => {
    writeRefused(root, 'why=gone\nat=/k/app\nts=2026-10-14T13:00:05Z\n');
    assert.equal(update.updateRefused(), null, 'an unknown why');
    writeRefused(root, 'why=locked\nts=2026-10-14T13:00:05Z\n');
    assert.equal(update.updateRefused(), null, 'no at');
    writeRefused(root, 'why=locked\nwhy=permissions\nat=/k/app\nts=2026-10-14T13:00:05Z\n');
    assert.equal(update.updateRefused(), null, 'why written twice');
  });
});

test('updateRefused: only bin, app and runtime are kept as parts, each once, and a CRLF file reads the same', () => {
  withRoot((root) => {
    writeRefused(root, 'why=locked\r\nat=/k/bin/kosmos\r\nts=2026-10-14T13:00:05Z\r\npart=bin\r\npart=../etc\r\npart=bin\r\n');
    assert.deepEqual(update.updateRefused().parts, ['bin']);
    assert.equal(update.updateRefused().at, '/k/bin/kosmos');
  });
});

test('lastAttempt: a failed attempt carries the refusal stamped at or after its start', () => {
  withRoot((root) => {
    writeStatus(root, 1, '2026-10-14T13:00:04.512Z');
    writeRefused(root, 'why=locked\nat=/k/app/engine/x.js\nts=2026-10-14T13:00:04Z\npart=app\n');
    const a = update.lastAttempt();
    assert.equal(a.code, 1);
    assert.deepEqual(a.refused, { why: 'locked', at: '/k/app/engine/x.js', parts: ['app'], paths: [path.join(root, 'app')], ts: '2026-10-14T13:00:04Z' },
      'the stamp has no fraction, so the same second still counts');
  });
});

test('lastAttempt: an OLDER refusal never explains a newer failure', () => {
  withRoot((root) => {
    writeStatus(root, 1, '2026-10-14T14:00:00.000Z');
    writeRefused(root, 'why=locked\nat=/k/app/engine/x.js\nts=2026-10-14T13:00:05Z\npart=app\n');
    const a = update.lastAttempt();
    assert.equal(a.code, 1, 'CONTROL: the failed attempt is there');
    assert.equal(a.refused, undefined);
  });
});

test('lastAttempt: a failed attempt with no refusal record carries none', () => {
  withRoot((root) => {
    writeStatus(root, 1, '2026-10-14T13:00:04.512Z');
    const a = update.lastAttempt();
    assert.equal(a.code, 1, 'CONTROL: the failed attempt is there');
    assert.equal(a.refused, undefined);
  });
});

test('lastAttempt: an attempt still in flight (no code) carries no refusal', () => {
  withRoot((root) => {
    fs.writeFileSync(path.join(root, 'logs', 'install.started'), '2026-10-14T13:00:04.512Z\n');
    writeRefused(root, 'why=locked\nat=/k/app/engine/x.js\nts=2026-10-14T13:00:09Z\npart=app\n');
    const a = update.lastAttempt();
    assert.ok(a, 'CONTROL: the interrupted attempt is there');
    assert.equal(a.code, null);
    assert.equal(a.refused, undefined);
  });
});

test('updateRefused: an immutable refusal (Linux chattr) reads like a locked one', () => {
  withRoot((root) => {
    writeRefused(root, 'why=immutable\nat=/k/app/engine/x.js\nts=2026-10-14T13:00:05Z\npart=app\n');
    assert.deepEqual(update.updateRefused(), { why: 'immutable', at: '/k/app/engine/x.js', parts: ['app'], paths: [path.join(root, 'app')], ts: '2026-10-14T13:00:05Z' });
  });
});
