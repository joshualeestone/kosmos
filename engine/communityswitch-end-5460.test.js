'use strict';
/**
 * #5460: a Community switch file that cannot be read ends the ON period (the sweep, #5435 review 5), but that is not the
 * person switching it off.
 *   1. After the switch is repaired, an item left unsent by that ended period still says the switch could not be read,
 *      not "switched off before it went out": the sweep records the period in state.json's `endedUnreadable`.
 *   2. A brief read failure (a scanner holding the file, EMFILE, a file caught mid-write) is read again before the
 *      switch counts as unreadable, so one such failure does not end the period for every agent.
 * Each case has a control: the person switching OFF still reads `before_on`, and an error that is not transient is
 * not retried.
 *
 *   node --test engine/communityswitch-end-5460.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-switchend-5460-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');
const status = require('./communitystatus');
const sw = require('./communityswitch');

test.after(() => { cs.setSwitch(null); cs.setSender(null); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function fresh() {
  const data = process.env.AGENT_WORKFORCE_DATA;
  assert.ok(data.startsWith(SANDBOX + path.sep), 'refusing to touch a data root outside this test\'s sandbox');
  fs.rmSync(data, { recursive: true, force: true });
}
const tick = () => new Promise((r) => setTimeout(r, 5));   // ISO stamps are per millisecond: keep made/since apart
function post(agent, topic) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), topic, body: topic + ' body.' }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
}
const stateOfTitle = (agent, title) => (status.itemsFor(agent).find((x) => x.title === title) || {}).state;
const readState = () => JSON.parse(fs.readFileSync(cs._paths.stateFile(), 'utf8'));
function startPeriod() {
  fs.mkdirSync(path.dirname(cs._paths.stateFile()), { recursive: true });
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(cs._paths.stateFile(), 'utf8')); } catch { /* none yet */ }
  fs.writeFileSync(cs._paths.stateFile(), JSON.stringify({ ...prior, since: new Date().toISOString() }) + '\n');
}

let position = { on: true, ok: true };
cs.setSwitch(() => position);
cs.setSender(() => { throw new Error('this test sends nothing'); });   // nothing may reach the network

test('#5460: after an unreadable switch is repaired, an item that period left unsent says why, not "switched off"', async () => {
  fresh();
  position = { on: true, ok: true };
  startPeriod();
  await tick();
  post('ava', 'Made while on');
  await tick();
  position = { on: false, ok: false };                 // the switch file cannot be read
  await cs.sweep();
  const ended = readState();
  assert.equal(ended.since, undefined, 'the sweep still ends the period for an unreadable switch (#5435)');
  assert.equal(ended.endedUnreadable.length, 1, 'the ended period is recorded');
  assert.equal(stateOfTitle('ava', 'Made while on'), 'switch_unreadable', 'while unreadable (as in #5435)');
  await tick();
  post('ava', 'Made while unreadable');                // after the period ended, the switch still unreadable
  await tick();
  position = { on: true, ok: true };                   // repaired
  await cs.sweep();
  const repaired = readState();
  assert.equal(typeof repaired.since, 'string', 'the repaired switch starts a new period');
  assert.equal(typeof repaired.endedUnreadable[0].until, 'string', 'the first sweep that reads it again closes the window');
  assert.equal(stateOfTitle('ava', 'Made while on'), 'switch_unreadable', 'after the repair it read "switched off before it went out"');
  assert.equal(stateOfTitle('ava', 'Made while unreadable'), 'switch_unreadable', 'an item made while still unreadable');
  await tick();
  post('ava', 'Made after the repair');
  assert.equal(stateOfTitle('ava', 'Made after the repair'), 'queued', 'the new period is not inside the window');
});

test('#5460 CONTROL: the person switching OFF still reads "switched off" after it comes back on, and records no window', async () => {
  fresh();
  position = { on: true, ok: true };
  startPeriod();
  await tick();
  post('bob', 'Made then switched off');
  await tick();
  position = { on: false, ok: true };                  // the person's OFF
  await cs.sweep();
  assert.equal(readState().endedUnreadable, undefined, 'an OFF must not be recorded as an unreadable switch');
  position = { on: true, ok: true };
  await cs.sweep();
  assert.equal(stateOfTitle('bob', 'Made then switched off'), 'before_on');
});

test('#5460: only the newest windows are kept', async () => {
  fresh();
  for (let i = 0; i < 25; i++) {
    position = { on: true, ok: true };
    startPeriod();
    position = { on: false, ok: false };
    await cs.sweep();
  }
  assert.equal(readState().endedUnreadable.length, 20);
});

/* The switch reader. fs.readFileSync is replaced for the switch file only, so each failure is staged exactly. */
function withReads(errors, fn) {
  const real = fs.readFileSync;
  let calls = 0;
  fs.readFileSync = function (file, ...rest) {
    if (file !== sw.FILE) return real.call(this, file, ...rest);
    const e = errors[calls++];
    if (e === 'TORN') return '{"on": tr';
    if (e) { const err = new Error(e); err.code = e; throw err; }
    return real.call(this, file, ...rest);
  };
  sw._setPause(() => {});
  try { return { r: fn(), calls: () => calls }; } finally { fs.readFileSync = real; }
}

test('#5460: a brief read failure or a file caught mid-write is read again before the switch counts as unreadable', () => {
  fresh();
  fs.mkdirSync(path.dirname(sw.FILE), { recursive: true });
  fs.writeFileSync(sw.FILE, JSON.stringify({ on: true }) + '\n');
  for (const code of ['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE', 'EIO', 'EAGAIN', 'TORN']) {
    const { r, calls } = withReads([code, code], () => sw.read());
    assert.deepEqual(r, { on: true, ok: true }, code + ' twice, then a good read, counted as unreadable');
    assert.equal(calls(), 3);
  }
  const always = withReads(Array(10).fill('EBUSY'), () => sw.read());
  assert.deepEqual(always.r, { on: false, ok: false }, 'a failure that lasts still reads unreadable');
  assert.equal(always.calls(), sw.RETRIES + 1, 'bounded: one read and RETRIES more');
});

test('#5460 CONTROL: an error that is not transient, and a file that parses to the wrong shape, are not read again', () => {
  fresh();
  fs.mkdirSync(path.dirname(sw.FILE), { recursive: true });
  fs.writeFileSync(sw.FILE, JSON.stringify({ on: true }) + '\n');
  const notdir = withReads(['ENOTDIR'], () => sw.read());
  assert.deepEqual(notdir.r, { on: false, ok: false });
  assert.equal(notdir.calls(), 1);
  fs.writeFileSync(sw.FILE, '[]\n');
  const shape = withReads([], () => sw.read());
  assert.deepEqual(shape.r, { on: false, ok: false });
  assert.equal(shape.calls(), 1);
  fs.rmSync(sw.FILE);
  assert.deepEqual(withReads([], () => sw.read()).r, { on: true, ok: true }, 'no file is still the never-asked ON');
});
