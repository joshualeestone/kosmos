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
});

test('saveSinceInstall runs one read at a time and survives a failure', async () => {
  let calls = 0;
  let release;
  const slow = () => { calls += 1; return new Promise((r) => { release = r; }); };
  const a = usage.saveSinceInstall(slow);
  const b = usage.saveSinceInstall(slow);
  assert.equal(a, b, 'a second call while one runs joins it');
  await Promise.resolve();
  release({});
  assert.equal(await a, true);
  assert.equal(calls, 1);
  assert.equal(await usage.saveSinceInstall(() => Promise.reject(new Error('disk'))), false);
  assert.equal(usage.startSaving(), false, 'no timers under the test runner');
});
