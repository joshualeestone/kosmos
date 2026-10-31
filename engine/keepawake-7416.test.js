'use strict';
/* kosmos#7416 slice 3: keep this computer awake while agents are working. The rule (engine/keepawake.js wants), the
   holder that runs caffeinate (with a fake spawn: nothing here starts a real caffeinate), and the setting
   (engine/keepawake-setting.js), whose file lives in a sandboxed store. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-keepawake-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const keepAwake = require('./keepawake');
const setting = require('./keepawake-setting');
const fleet = require('../test-support/fleet');

test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* Real board cards (snapshot().agents), never hand-built ones (fixture-discipline.test.js). */
const realCards = (...specs) => {
  const b = fleet.install(specs.map(([name, state = 'idle']) => fleet.agent(name, { state })));
  return specs.map(([name]) => b.card(name));
};

/* A spawn that records each call and hands back a child the test can end. */
function fakeSpawn() {
  const calls = [];
  const fn = (cmd, args, opts) => {
    const c = new EventEmitter();
    c.killed = [];
    c.kill = (sig) => { c.killed.push(sig); };
    c.unref = () => {};
    calls.push({ cmd, args, opts, child: c });
    return c;
  };
  fn.calls = calls;
  return fn;
}

test('#7416 slice 3: it holds only while the switch is on and a card reads working', () => {
  const [busy, quiet] = realCards(['Busy', 'working'], ['Quiet', 'idle']);
  assert.equal(busy.state, 'working', 'CONTROL: the fleet made a working card');
  assert.equal(keepAwake.wants({ on: true, agents: [busy, quiet] }), true, 'a working agent did not keep the computer awake');
  assert.equal(keepAwake.wants({ on: false, agents: [busy, quiet] }), false, 'the switch was off and it held anyway');
  assert.equal(keepAwake.wants({ on: true, agents: [quiet] }), false, 'nothing was working and it held');
  assert.equal(keepAwake.wants({ on: true, agents: [] }), false);
  assert.equal(keepAwake.wants({ on: true, agents: null }), false, 'an unread roster claimed work');
  assert.equal(keepAwake.wants({ on: 'yes', agents: [busy] }), false, 'a setting that is not exactly true held');
});

test('#7416 slice 3: the holder runs caffeinate -i -w <board pid> once, and stops it when asked', () => {
  const spawn = fakeSpawn();
  const h = keepAwake.createHolder({ platform: 'darwin', spawn, pid: 4242, now: () => 1000 });
  assert.equal(h.supported, true);
  assert.deepEqual(h.state(), { holding: false, since: null, because: '' });
  h.set(true);
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].cmd, '/usr/bin/caffeinate');
  assert.deepEqual(spawn.calls[0].args, ['-i', '-w', '4242'], 'not idle-sleep only, or not tied to the board process');
  assert.deepEqual(h.state(), { holding: true, since: 1000, because: '' });
  h.set(true);
  assert.equal(spawn.calls.length, 1, 'a second pass started a second caffeinate');
  h.set(false);
  assert.deepEqual(spawn.calls[0].child.killed, ['SIGTERM'], 'the held caffeinate was not stopped');
  assert.equal(h.state().holding, false);
  h.set(false);
  assert.deepEqual(spawn.calls[0].child.killed, ['SIGTERM'], 'stopping twice signalled twice');
});

test('#7416 slice 3: a caffeinate that ends by itself is noticed, and the next pass starts another', () => {
  const spawn = fakeSpawn();
  const h = keepAwake.createHolder({ platform: 'darwin', spawn, pid: 1 });
  h.set(true);
  spawn.calls[0].child.emit('exit', 0, null);
  assert.equal(h.state().holding, false, 'a caffeinate killed from outside still read as holding');
  assert.equal(h.state().because, 'caffeinate stopped by itself', 'a caffeinate that died said nothing');
  h.set(true);
  assert.equal(spawn.calls.length, 2, 'the hold was not taken again');
  /* An exit from the OLD child after a new one started must not clear the new one. */
  spawn.calls[0].child.emit('exit', 0, null);
  assert.equal(h.state().holding, true, 'a stale exit cleared the live hold');
  assert.equal(h.state().because, '', 'a stale exit reported a failure for the live hold');
  h.set(false);
  assert.equal(h.state().because, '', 'stopping it on purpose reported a failure');
});

test('#7416 slice 3: a caffeinate that cannot start says why and holds nothing', () => {
  const thrown = keepAwake.createHolder({ platform: 'darwin', pid: 1, spawn: () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; } });
  thrown.set(true);
  assert.equal(thrown.state().holding, false);
  assert.match(thrown.state().because, /caffeinate did not start \(ENOENT\)/);
  thrown.set(false);
  assert.equal(thrown.state().because, '', 'a failure stayed reported once nothing needed holding');
  const spawn = fakeSpawn();
  const late = keepAwake.createHolder({ platform: 'darwin', spawn, pid: 1 });
  late.set(true);
  const e = new Error('spawn failed'); e.code = 'EACCES';
  spawn.calls[0].child.emit('error', e);
  assert.equal(late.state().holding, false, 'a caffeinate that failed to start read as holding');
  assert.match(late.state().because, /EACCES/);
});

test('#7416 slice 3: off a Mac nothing is ever started (the Windows half is separate)', () => {
  for (const platform of ['win32', 'linux']) {
    const spawn = fakeSpawn();
    const h = keepAwake.createHolder({ platform, spawn, pid: 1 });
    assert.equal(h.supported, false);
    h.set(true);
    assert.equal(spawn.calls.length, 0, `caffeinate was started on ${platform}`);
  }
});

test('#7416 slice 3: a pass reads the roster only while on, and an unread roster leaves the hold as it is', () => {
  const [busy, quiet] = realCards(['Busy2', 'working'], ['Quiet2', 'idle']);
  const spawn = fakeSpawn();
  const holder = keepAwake.createHolder({ platform: 'darwin', spawn, pid: 1 });
  let reads = 0;
  const on = () => ({ on: true, ok: true });
  keepAwake.pass({ readSetting: on, readRoster: () => { reads += 1; return [busy, quiet]; }, holder });
  assert.equal(holder.state().holding, true, 'a working card did not take the hold');
  keepAwake.pass({ readSetting: on, readRoster: () => null, holder });
  assert.equal(holder.state().holding, true, 'a roster that could not be read let go mid-turn');
  keepAwake.pass({ readSetting: on, readRoster: () => { throw new Error('tmux'); }, holder });
  assert.equal(holder.state().holding, true, 'a roster read that threw let go mid-turn');
  keepAwake.pass({ readSetting: on, readRoster: () => [quiet], holder });
  assert.equal(holder.state().holding, false, 'CONTROL: nothing working lets go');
  keepAwake.pass({ readSetting: on, readRoster: () => null, holder });
  assert.equal(spawn.calls.length, 1, 'an unread roster took the hold');
  keepAwake.pass({ readSetting: on, readRoster: () => [busy], holder });
  for (let i = 1; i < keepAwake.UNREAD_PASSES_MAX; i += 1) keepAwake.pass({ readSetting: on, readRoster: () => null, holder });
  assert.equal(holder.state().holding, true, 'the hold went before the unread passes ran out');
  keepAwake.pass({ readSetting: on, readRoster: () => [busy], holder });
  for (let i = 1; i < keepAwake.UNREAD_PASSES_MAX; i += 1) keepAwake.pass({ readSetting: on, readRoster: () => null, holder });
  assert.equal(holder.state().holding, true, 'a readable roster did not start the count again');
  keepAwake.pass({ readSetting: on, readRoster: () => null, holder });
  assert.equal(holder.state().holding, false, 'a roster unread for five minutes kept the computer awake');
  keepAwake.pass({ readSetting: on, readRoster: () => [busy], holder });
  const before = reads;
  keepAwake.pass({ readSetting: () => ({ on: false, ok: false }), readRoster: () => { reads += 1; return [busy]; }, holder });
  assert.equal(holder.state().holding, false, 'an unreadable setting kept the hold');
  keepAwake.pass({ readSetting: () => ({ on: false, ok: true }), readRoster: () => { reads += 1; return [busy]; }, holder });
  assert.equal(reads, before, 'the roster was read while the switch was off');
});

test('#7416 slice 3: the setting reads off when never set or unreadable, and saves true or false', () => {
  assert.equal(path.dirname(setting.FILE).startsWith(SANDBOX), true, 'CONTROL: the setting file is in the sandbox');
  try { fs.rmSync(setting.FILE); } catch { /* not there */ }
  assert.deepEqual(setting.read(), { on: false, ok: true }, 'a person who never chose it got it on');
  assert.deepEqual(setting.write({ on: true }), { ok: true });
  assert.deepEqual(setting.read(), { on: true, ok: true });
  assert.deepEqual(setting.write({}), { ok: true });
  assert.deepEqual(setting.read(), { on: true, ok: true }, 'a save with no value changed it');
  fs.writeFileSync(setting.FILE, '{not json');
  assert.deepEqual(setting.read(), { on: false, ok: false }, 'a corrupt file held the computer awake');
  fs.writeFileSync(setting.FILE, JSON.stringify({ on: 'true' }));
  assert.deepEqual(setting.read(), { on: false, ok: true }, 'a value that is not exactly true read on');
  fs.rmSync(setting.FILE);
});
