'use strict';
require('../test-support/tmpscope');
/* kosmos#6829: the install day Token Usage counts from, and the all-time read built on it. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-installday-'));
process.env.HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_HOME = process.env.HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude-projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const usage = require('./usage');
const ping = require('./ping');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const T = () => '2026-10-21';

test('installDay is the earliest of the install-id time and first-run completion', () => {
  assert.equal(usage.installDay({ today: T, installedAt: () => '2026-09-01T23:30:00.000Z', firstRun: () => ({ done: true, at: '2026-09-03T10:00:00.000Z' }) }), '2026-09-01');
  assert.equal(usage.installDay({ today: T, installedAt: () => '2026-09-05T00:00:00.000Z', firstRun: () => ({ done: true, at: '2026-08-30T00:00:00.000Z' }) }), '2026-08-30');
  assert.equal(usage.installDay({ today: T, installedAt: () => null, firstRun: () => ({ done: false }) }), '2026-10-21', 'neither: today');
  assert.equal(usage.installDay({ today: T, installedAt: () => 'garbage', firstRun: () => { throw new Error('x'); } }), '2026-10-21', 'unreadable: today');
  assert.equal(usage.installDay({ today: T, installedAt: () => '2027-01-01T00:00:00.000Z', firstRun: () => ({ done: false }) }), '2026-10-21', 'a future time never starts the count after today');
});

test('usageSinceInstall asks for install day through today, inclusive', async () => {
  const asked = [];
  const daily = async (n) => { asked.push(n); return { byDay: {}, byFolder: {}, rootsRead: [] }; };
  const one = await usage.usageSinceInstall({ today: T, installedAt: () => '2026-10-21T08:00:00.000Z', firstRun: () => ({}), daily });
  assert.equal(one.days, 1, 'install day itself is day 1');
  assert.equal(one.installDay, '2026-10-21');
  const forty = await usage.usageSinceInstall({ today: T, installedAt: () => '2026-09-12T08:00:00.000Z', firstRun: () => ({}), daily });
  assert.equal(forty.days, 40);
  assert.deepEqual(asked, [1, 40]);
});

test('ping records installedAt when it mints the id, keeps it through later writes, and falls back to the file time', () => {
  fs.rmSync(ping.FILE, { force: true });
  assert.equal(ping.installedAt(), null, 'no install yet: no time, and nothing minted');
  assert.equal(fs.existsSync(ping.FILE), false);
  const before = Date.now();
  ping.installId();
  const at = Date.parse(ping.installedAt());
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, 'minted now');
  assert.equal(ping.read().installedAt, ping.installedAt(), 'read() keeps the field, so write() cannot drop it');
  // An install that predates the field: the file's own time.
  fs.writeFileSync(ping.FILE, JSON.stringify({ installId: 'old' }) + '\n');
  const old = new Date('2026-08-21T23:18:45.000Z');
  fs.utimesSync(ping.FILE, old, old);
  assert.equal(ping.installedAt(), old.toISOString());
  // ...and records it, so a copy that does not keep the mtime cannot move it later.
  const now = new Date();
  fs.utimesSync(ping.FILE, now, now);
  assert.equal(ping.installedAt(), old.toISOString(), 'the recorded time wins over the new mtime');
  assert.equal(ping.read().installId, 'old', 'recording it kept the id');
});

test('the timed save holds a recent day a partial scan could not fully read; a page request saves as before', { skip: process.getuid && process.getuid() === 0 ? 'root reads a mode-000 folder' : false }, async () => {
  const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
  const proj = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects');
  const ok = path.join(proj, 'ok');
  const locked = path.join(proj, 'locked');
  fs.mkdirSync(ok, { recursive: true });
  fs.mkdirSync(locked, { recursive: true });
  const row = JSON.stringify({ timestamp: `${day(3)}T09:00:00.000Z`, sessionId: 's', message: { id: 'm1', model: 'claude-u', usage: { input_tokens: 5, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
  const oldRow = JSON.stringify({ timestamp: `${day(25)}T09:00:00.000Z`, sessionId: 's', message: { id: 'm2', model: 'claude-u', usage: { input_tokens: 9, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
  fs.writeFileSync(path.join(ok, 's.jsonl'), row + '\n' + oldRow + '\n');
  const frozen = path.join(usage.USAGE_DIR, `${day(3)}.v2.json`);
  const frozenOld = path.join(usage.USAGE_DIR, `${day(25)}.v2.json`);
  fs.rmSync(frozen, { force: true });
  fs.rmSync(frozenOld, { force: true });
  fs.chmodSync(locked, 0o000);
  try {
    const a = await usage.dailyUsageByModel(26, { holdPartial: true });
    assert.equal(a.byDay[day(3)]['claude-u'].input_tokens, 5, 'shown');
    assert.equal(fs.existsSync(frozen), false, 'the timed save does not save a recent day while a folder could not be read');
    // A day near Claude's own deletion is saved with what could be read: waiting can only lose more of it.
    assert.equal(JSON.parse(fs.readFileSync(frozenOld, 'utf8'))['claude-u'].input_tokens, 9);
    // A request from the page is unchanged: it saves what it read, so a lasting bad file cannot make every open slow.
    await usage.dailyUsageByModel(26);
    assert.equal(fs.existsSync(frozen), true, 'a page request saves as before');
  } finally {
    fs.chmodSync(locked, 0o755);
  }
});

test('saveSinceInstall runs one read at a time and survives a failure', async () => {
  let calls = 0;
  let release;
  let go;
  const started = new Promise((r) => { go = r; });
  const slow = () => { calls += 1; go(); return new Promise((r) => { release = r; }); };
  const a = usage.saveSinceInstall(slow);
  const b = usage.saveSinceInstall(slow);
  assert.equal(a, b, 'a second call while one runs joins it');
  await started;
  release({});
  assert.equal(await a, true);
  assert.equal(calls, 1);
  assert.equal(await usage.saveSinceInstall(() => Promise.reject(new Error('disk'))), false);
  assert.equal(usage.startSaving(), false, 'no timers under the test runner');
});

test('the page read waits for a timed save already running, and vice versa', async () => {
  const order = [];
  let release;
  const held = new Promise((r) => { release = r; });
  const save = usage.saveSinceInstall(async () => { order.push('save start'); await held; order.push('save end'); });
  const page = usage.readSinceInstall(async () => { order.push('page'); });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['save start'], 'the page read has not started while the save runs');
  release();
  await Promise.all([save, page]);
  assert.deepEqual(order, ['save start', 'save end', 'page']);
});
