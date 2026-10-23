'use strict';
require('../test-support/tmpscope');
/* kosmos#6590 (S-7d branch c, c1a): the engine half of the typed-code Allow. Every tunnel call goes through a fake spawn
   that records argv and answers a fixed line, so nothing real runs. Inert without the board-v2 marker; with it, the
   argv shape (`--` before the values), the refusals made before any spawn, the shared read of `devices waiting`, and
   the coordinator's phone rows leaving the pending list. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-typedallow-6590-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const STATE = path.join(SANDBOX, 'tunnel-state');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.AGENT_WORKFORCE_TUNNEL_BIN = '/usr/bin/false';
process.env.AGENT_WORKFORCE_TUNNEL_RELAY = 'relay.test:443';
const remote = require('./remote');

const calls = [];
let answer = () => ({ out: '{}', code: 0 });
function fakeSpawn(bin, args) {
  calls.push(args);
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = null;
  child.kill = () => {};
  const { out = '', err = '', code = 0 } = answer(args);
  setImmediate(() => {
    if (out) child.stdout.emit('data', out);
    if (err) child.stderr.emit('data', err);
    child.emit('exit', code);
    child.emit('close', code);
  });
  return child;
}
const KNOCK = 'AbCdEfGhIjKlMnOpQrStUv';   // 22 base64url characters, the tunnel's KnockId shape
const DASHED = '-bCdEfGhIjKlMnOpQrStUv';

function setup({ marker = true, on = true } = {}) {
  remote.resetForTests();
  remote.setSetupSpawnForTests(fakeSpawn);
  calls.length = 0;
  answer = () => ({ out: '{}', code: 0 });
  fs.rmSync(STATE, { recursive: true, force: true });
  fs.mkdirSync(STATE, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'fake');
  if (marker) fs.writeFileSync(path.join(STATE, 'board-v2'), '');
  remote.setOn(on);
  calls.length = 0;
}
const devicesCalls = () => calls.filter((a) => a[0] === 'devices');
test.after(() => { remote.resetForTests(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('without the board-v2 marker nothing is asked and nothing is allowed by typed code', async () => {
  setup({ marker: false });
  const w = await remote.devicesWaiting();
  assert.equal(w.ok, true);
  assert.equal(w.data.v2, false);
  assert.equal(w.data.count, 0);
  for (const r of [await remote.deviceAllowCode(KNOCK, 'ABC-DEF'), await remote.deviceDropWaiting(KNOCK), await remote.devicesClearWaiting()]) {
    assert.equal(r.ok, false, JSON.stringify(r));
  }
  assert.deepEqual(devicesCalls(), [], 'a tunnel call was made before the marker');
  assert.equal(remote.boardV2(), false);
});

test('switched off, the marker present: waiting spawns nothing', async () => {
  setup({ on: false });
  const w = await remote.devicesWaiting();
  assert.deepEqual([w.ok, w.data.v2, w.data.count], [true, true, 0]);
  assert.deepEqual(devicesCalls(), []);
});

test('waiting is read once for concurrent asks, kept a moment, and its rows are checked', async () => {
  setup();
  answer = (args) => (args[1] === 'waiting' ? { out: JSON.stringify({ count: 3, waiting: [
    { knockId: KNOCK, firstSeen: 100, uaClass: 'iPhone or iPad', net: '203.0.113.0', vouched: false },
    { knockId: '../evil', firstSeen: 1, uaClass: 'x', net: 'y', vouched: true },
    { knockId: DASHED, firstSeen: 'soon', uaClass: 7, net: null, vouched: 'yes' },
  ], ctAlarm: true, ctFinding: 'not-a-hash' }) } : { out: '{}' });
  const [a, b] = await Promise.all([remote.devicesWaiting(), remote.devicesWaiting()]);
  assert.equal(devicesCalls().length, 1, 'two asks, one spawn');
  assert.deepEqual(a, b);
  assert.deepEqual(devicesCalls()[0], ['devices', 'waiting', '--state-dir', STATE]);
  assert.equal(a.data.count, 2, 'a row with an id that is not a knock id is dropped');
  assert.deepEqual(a.data.waiting[1], { knockId: DASHED, firstSeen: 0, uaClass: '', net: '', vouched: false });
  assert.equal(a.data.ctAlarm, true);
  assert.equal(a.data.ctFinding, null, 'a finding that is not a hash is not passed on');
  await remote.devicesWaiting();
  assert.equal(devicesCalls().length, 1, 'kept for a moment');
});

test('a typed code goes after --, and the refusals before any spawn', async () => {
  setup();
  answer = () => ({ out: JSON.stringify({ allowed: true, device_id: 'd1', acked: true }) });
  const ok = await remote.deviceAllowCode(DASHED, ' -abc-def ');
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.data.device_id, 'd1');
  const argv = devicesCalls()[0];
  assert.deepEqual(argv.slice(0, 2), ['devices', 'allow-code']);
  const dash = argv.indexOf('--');
  assert.ok(dash > 0, 'no -- before the values');
  assert.deepEqual(argv.slice(dash + 1), [DASHED, '-abc-def'], 'the knock id and the trimmed code, after --');
  assert.ok(argv.includes('--coordinator') && argv.includes('--state-dir'));
  calls.length = 0;
  for (const [id, code] of [[KNOCK, ''], [KNOCK, '   '], [KNOCK, 'ab\u0000c'], [KNOCK, 'ab\nc'], ['short', 'ABC-DEF'], [null, 'ABC-DEF']]) {
    const r = await remote.deviceAllowCode(id, code);
    assert.equal(r.ok, false, JSON.stringify([id, code]));
  }
  assert.deepEqual(devicesCalls(), [], 'a refused input reached the tunnel');
});

test('the tunnel\'s answers: wrong with tries left, paused, Kosmos+ never asked, and never a sentence that holds the code', async () => {
  setup();
  answer = () => ({ out: JSON.stringify({ allowed: false, acked: false, because: 'That is not the code that browser shows. 3 more tries for it.', tries_left: 3 }) });
  let r = await remote.deviceAllowCode(KNOCK, 'ZZZ-ZZZ');
  assert.deepEqual([r.ok, r.triesLeft], [false, 3]);
  assert.match(r.because, /3 more tries/);
  answer = () => ({ out: JSON.stringify({ allowed: false, acked: false, paused: true }) });
  r = await remote.deviceAllowCode(KNOCK, 'ZZZ-ZZZ');
  assert.deepEqual([r.ok, r.paused], [false, true]);
  answer = () => ({ out: JSON.stringify({ allowed: true, device_id: 'd1', acked: false, account_ack: 'unknown_device' }) });
  r = await remote.deviceAllowCode(KNOCK, 'ZZZ-ZZZ');
  assert.deepEqual([r.ok, r.listed], [false, true]);
  // A failure whose words carry the typed code is never passed on, from either stream.
  answer = () => ({ err: "error: unexpected argument 'QQQ-QQQ' found", code: 2 });
  r = await remote.deviceAllowCode(KNOCK, 'QQQ-QQQ');
  assert.equal(r.ok, false);
  assert.ok(!r.because.includes('QQQ-QQQ'), r.because);
  answer = () => ({ out: JSON.stringify({ allowed: false, acked: false, because: 'you typed QQQ-QQQ' }) });
  r = await remote.deviceAllowCode(KNOCK, 'QQQ-QQQ');
  assert.ok(!r.because.includes('QQQ-QQQ'), r.because);
});

test('Not me and clear-waiting: argv, answers, and the shared read is flushed after each', async () => {
  setup();
  let rows = 1;
  answer = (args) => {
    if (args[1] === 'waiting') return { out: JSON.stringify({ count: rows, waiting: rows ? [{ knockId: KNOCK, firstSeen: 1, uaClass: '', net: '', vouched: false }] : [] }) };
    if (args[1] === 'drop-waiting') { rows = 0; return { out: JSON.stringify({ dropped: 2, allowed: false }) }; }
    if (args[1] === 'clear-waiting') return { out: JSON.stringify({ cleared: 0 }) };
    return { out: '{}' };
  };
  assert.equal((await remote.devicesWaiting()).data.count, 1);
  const d = await remote.deviceDropWaiting(DASHED);
  assert.deepEqual(d.data, { dropped: 2, allowed: false, device_id: null });
  assert.deepEqual(devicesCalls().at(-1), ['devices', 'drop-waiting', '--state-dir', STATE, '--', DASHED]);
  assert.equal((await remote.devicesWaiting()).data.count, 0, 'a stale row was served after Not me');
  answer = (args) => (args[1] === 'drop-waiting' ? { out: JSON.stringify({ dropped: 1, allowed: true, device_id: 'd2' }) } : { out: JSON.stringify({ cleared: 4 }) });
  assert.deepEqual((await remote.deviceDropWaiting(KNOCK)).data, { dropped: 1, allowed: true, device_id: 'd2' });
  const c = await remote.devicesClearWaiting();
  assert.deepEqual(c.data, { cleared: 4 });
  assert.deepEqual(devicesCalls().at(-1), ['devices', 'clear-waiting', '--state-dir', STATE]);
});

test('under the marker the coordinator\'s phone and browser rows leave the pending list; computers stay', () => {
  const rows = { devices: [
    { device_id: 'dev-phone', name: 'iPhone', first_seen: 1, code: 'K7-3M' },
    { device_id: 'dev-pc', name: 'pc', first_seen: 1, code: 'X3-P2', joining_computer: 'windowsbox' },
    { device_id: 'computer:0123456789abcdef0123456789abcdef', name: 'mac', first_seen: 1, code: '' },
    { device_id: 'dev-wait', name: 'pc2', first_seen: 1, code: '', code_wait: 'attempts_used' },
    { device_id: 'dev-check', name: 'pc3', first_seen: 1, code: '123 456', recheck: true },
  ] };
  setup({ marker: false });
  fs.writeFileSync(path.join(STATE, 'pending.json'), JSON.stringify(rows));
  const before = remote.pendingDevices().devices.map((d) => d.device_id);
  assert.ok(before.includes('dev-phone'), 'control: without the marker the phone row is shown: ' + before);
  fs.writeFileSync(path.join(STATE, 'board-v2'), '');
  const after = remote.pendingDevices().devices.map((d) => d.device_id).sort();
  assert.deepEqual(after, ['computer:0123456789abcdef0123456789abcdef', 'dev-check', 'dev-pc', 'dev-wait']);
  assert.equal(remote.listedAsComputer('dev-pc'), true);
  assert.equal(remote.listedAsComputer('dev-check'), true);
  assert.equal(remote.listedAsComputer('dev-phone'), false);
  assert.equal(remote.listedAsComputer('not-listed'), false);
});
