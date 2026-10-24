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
const stdins = [];
let answer = () => ({ out: '{}', code: 0 });
function fakeSpawn(bin, args) {
  calls.push(args);
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { on() {}, end(v) { stdins.push([args, String(v)]); } };
  child.kill = () => {};
  const { out = '', err = '', code = 0, wait = null } = answer(args);
  Promise.resolve(wait).then(() => setImmediate(() => {
    if (out) child.stdout.emit('data', out);
    if (err) child.stderr.emit('data', err);
    child.emit('exit', code);
    child.emit('close', code);
  }));
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
  // A failure whose words carry the typed code, in any case, is never passed on.
  answer = () => ({ err: "error: unexpected argument 'QQQ-QQQ' found", code: 2 });
  r = await remote.deviceAllowCode(KNOCK, 'qqq-qqq');
  assert.equal(r.ok, false);
  assert.ok(!/qqq-qqq/i.test(r.because), r.because);
  // ...nor when the words carry its letters and digits alone, in another case (review 2).
  answer = () => ({ err: "error: unexpected argument 'QQQQQQ' found", code: 2 });
  r = await remote.deviceAllowCode(KNOCK, 'qqq-qqq');
  assert.ok(!/q{6}/i.test(r.because), r.because);
  // The answer's own sentence is the tunnel's and is kept, even when a short code happens to appear in it (review 1).
  answer = () => ({ out: JSON.stringify({ allowed: false, acked: false, because: 'Too many wrong codes in the last minute. Wait a minute and try again.' }) });
  r = await remote.deviceAllowCode(KNOCK, 'a');
  assert.match(r.because, /Too many wrong codes/);
});

test('a read started before an Allow is never handed out after it (review 1)', async () => {
  setup();
  let rows = 1;
  let release;
  const held = new Promise((res) => { release = res; });
  let firstWaiting = true;
  answer = (args) => {
    if (args[1] === 'waiting') {
      const out = JSON.stringify({ count: rows, waiting: rows ? [{ knockId: KNOCK, firstSeen: 1, uaClass: '', net: '', vouched: false }] : [] });
      if (firstWaiting) { firstWaiting = false; return { out, wait: held }; }
      return { out };
    }
    if (args[1] === 'allow-code') { rows = 0; return { out: JSON.stringify({ allowed: true, device_id: 'd1', acked: true }) }; }
    return { out: '{}' };
  };
  const before = remote.devicesWaiting();   // in flight, holding the one row
  assert.equal((await remote.deviceAllowCode(KNOCK, 'ABC-DEF')).ok, true);
  const after = remote.devicesWaiting();
  release();
  assert.equal((await before).data.count, 1, 'control: the early read did see the row');
  assert.equal((await after).data.count, 0, 'the allowed row was shown again');
  assert.equal((await remote.devicesWaiting()).data.count, 0, 'and the early read was not kept');
});

test('switched off: a typed code spawns nothing', async () => {
  setup({ on: false });
  const r = await remote.deviceAllowCode(KNOCK, 'ABC-DEF');
  assert.equal(r.ok, false);
  assert.deepEqual(devicesCalls(), []);
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
  // c3: the browser had just been let in, so this Not me takes it back out (a Remove follows).
  assert.deepEqual((await remote.deviceDropWaiting(KNOCK)).data, { dropped: 1, allowed: true, device_id: 'd2', takenBack: true });
  assert.ok(devicesCalls().some((a) => a[1] === 'remove' && a.includes('d2')), 'not taken back');
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
    { device_id: 'dev-oddname', name: 'odd', first_seen: 1, code: 'Q1-Z9', joining_computer: '<b>x</b>' },
    { device_id: 'dev-oddwait', name: 'odd', first_seen: 1, code: 'Q1-Z9', code_wait: 'made-up' },
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
  // The page's own rules: a computer name it would not show, or a wait reason it does not know, is no computer (review 1).
  assert.equal(remote.listedAsComputer('dev-oddname'), false);
  assert.equal(remote.listedAsComputer('dev-oddwait'), false);
});

/* kosmos#6590 (c2): this computer's own sign-in is acked, never allowed, under the marker. */
function setOwnId(id) {
  const file = path.join(require('./store').ROOT, 'remote.json');
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...cur, device_id: id }));
}
const settle = () => new Promise((r) => setTimeout(r, 60));

test('c2: under the marker the own sign-in is acked (no allow); without it, allowed as before', async () => {
  setup();
  setOwnId('selfdev1');
  answer = (args) => (args[1] === 'ack' ? { out: JSON.stringify({ device_id: 'selfdev1', acked: true }) } : { out: JSON.stringify({ allowed: true }) });
  assert.equal(remote.allowSelfQuietlyForTests(), true);
  await settle();
  assert.deepEqual(devicesCalls().map((a) => a[1]), ['ack']);
  assert.ok(devicesCalls()[0].includes('--device-id=selfdev1'), JSON.stringify(devicesCalls()[0]));
  setup({ marker: false });
  setOwnId('selfdev1');
  assert.equal(remote.allowSelfQuietlyForTests(), true);
  await settle();
  assert.deepEqual(devicesCalls().map((a) => a[1]), ['allow'], 'control: without the marker the old allow runs');
});

test('c2: the ack is ok only when Kosmos+ took it; a pause is said as paused; an id starting with - stays one argument', async () => {
  setup();
  answer = () => ({ out: JSON.stringify({ device_id: '-dev', acked: true }) });
  let r = await remote.deviceAckSelfForTests('-dev');
  assert.equal(r.ok, true);
  assert.ok(devicesCalls().at(-1).includes('--device-id=-dev'));
  answer = () => ({ out: JSON.stringify({ device_id: 'dev', acked: false }) });
  r = await remote.deviceAckSelfForTests('dev');
  assert.equal(r.ok, false, 'acked false is not a grant');
  answer = () => ({ err: 'Error: Kosmos+ is paused for maintenance: no new Allow until it is back', code: 1 });
  r = await remote.deviceAckSelfForTests('dev');
  assert.deepEqual([r.ok, r.paused], [false, true]);
  r = await remote.deviceAckSelfForTests('../evil');
  assert.equal(r.ok, false);
});

/* kosmos#6590 (c3): the automatic Allow on this computer's own address, matched by the tunnel. */
function armVouch() {
  setup();
  fs.writeFileSync(path.join(STATE, 'address'), 'josh1023.kosmosplus.com');
  fs.writeFileSync(path.join(STATE, 'pending.json'), JSON.stringify({ devices: [], signins: [{ device_id: 'dev-web', first_seen: Math.floor(Date.now() / 1000) }] }));
  remote.setCompanyOpenSourceForTests({ platform: process.platform, env: Object.assign({}, process.env, { DISPLAY: ':0' }) });
  remote.setCompanyOpenCommandForTests(['/usr/bin/true']);
  stdins.length = 0;
  return remote.startVouchForTests();
}
const VROW = (id) => ({ knockId: id, firstSeen: 1, uaClass: 'Mac', net: '', vouched: true });

test('c3: under the marker the browser opens on this computer\'s own address, and the window starts when it opens', async () => {
  const S = armVouch();
  assert.ok(S, 'premise: a secret');
  const before = remote.vouchUntilForTests();
  await new Promise((r) => setTimeout(r, 20));
  remote.vouchTickForTests();
  assert.equal(remote.vouchOpenedUrlForTests(), 'https://josh1023.kosmosplus.com/#allow=' + S);
  assert.ok(remote.vouchUntilForTests() > before, 'the window did not start again when the tab opened');
  // CONTROL: without the marker it is the coordinator's page, and the window does not move.
  remote.resetForTests();
  setup({ marker: false });
  fs.writeFileSync(path.join(STATE, 'pending.json'), JSON.stringify({ devices: [], signins: [{ device_id: 'dev-web', first_seen: Math.floor(Date.now() / 1000) }] }));
  remote.setCompanyOpenSourceForTests({ platform: process.platform, env: Object.assign({}, process.env, { DISPLAY: ':0' }) });
  remote.setCompanyOpenCommandForTests(['/usr/bin/true']);
  const S2 = remote.startVouchForTests();
  const b2 = remote.vouchUntilForTests();
  await new Promise((r) => setTimeout(r, 20));
  remote.vouchTickForTests();
  assert.ok(remote.vouchOpenedUrlForTests().endsWith('/#allow=' + S2) && !remote.vouchOpenedUrlForTests().includes('josh1023'));
  assert.equal(remote.vouchUntilForTests(), b2);
});

test('c3: a vouched waiting row is offered to the tunnel with S on stdin only; allowed ends S and notes the device', async () => {
  const S = armVouch();
  remote.vouchTickForTests();   // opens
  answer = (args) => {
    if (args[1] === 'waiting') return { out: JSON.stringify({ count: 1, waiting: [VROW(KNOCK)] }) };
    if (args[1] === 'allow-vouched') return { out: JSON.stringify({ allowed: true, device_id: 'dvouched', acked: true }) };
    return { out: '{}' };
  };
  remote.vouchTickForTests();
  await settle();
  const av = devicesCalls().filter((a) => a[1] === 'allow-vouched');
  assert.equal(av.length, 1);
  assert.ok(!av[0].some((x) => x.includes(S)), 'S was on argv');
  assert.deepEqual(stdins.filter(([a]) => a[1] === 'allow-vouched').map(([, v]) => v), [S]);
  assert.equal(remote.vouchSecretForTests(), null, 'S did not end after the allow');
  assert.ok(remote.read().vouched && remote.read().vouched.dvouched, 'the device was not noted as on this computer');
});

test('c3: no match keeps S and never retries that row; two keys end S; a passing refusal is retried and not counted', async () => {
  const S = armVouch();
  remote.vouchTickForTests();
  let verdict = { allowed: false, acked: false, reason: 'no_row', because: 'x' };
  answer = (args) => {
    if (args[1] === 'waiting') return { out: JSON.stringify({ count: 1, waiting: [VROW(KNOCK)] }) };
    if (args[1] === 'allow-vouched') return { out: JSON.stringify(verdict) };
    return { out: '{}' };
  };
  const runs = () => devicesCalls().filter((a) => a[1] === 'allow-vouched').length;
  remote.vouchTickForTests(); await settle();
  assert.equal(runs(), 1);
  assert.equal(remote.vouchSecretForTests(), S, 'a row that did not match ended S');
  remote.vouchTickForTests(); await settle();
  assert.equal(runs(), 1, 'the same row was tried again');
  // A passing refusal (the certificate alarm): not marked tried, so it is offered again once the wait is over.
  answer = (args) => (args[1] === 'waiting' ? { out: JSON.stringify({ count: 1, waiting: [VROW(DASHED)] }) }
    : args[1] === 'allow-vouched' ? { out: JSON.stringify({ allowed: false, acked: false, reason: 'ct_alarm', because: 'x' }) } : { out: '{}' });
  await new Promise((r) => setTimeout(r, 2100));   // past the shared read of the waiting list (WAITING_FRESH_MS)
  remote.vouchTickForTests(); await settle();
  assert.equal(runs(), 2);
  remote.vouchTickForTests(); await settle();
  assert.equal(runs(), 2, 'retried before its wait');
  remote.vouchPatchForTests({ retryAt: 0 });
  remote.vouchTickForTests(); await settle();
  assert.equal(runs(), 3, 'a passing refusal was marked tried');
  assert.equal(remote.vouchSecretForTests(), S);
  // Two keys reproduce S: it has leaked, so it ends.
  answer = (args) => (args[1] === 'waiting' ? { out: JSON.stringify({ count: 1, waiting: [VROW('ZbCdEfGhIjKlMnOpQrStUx')] }) }
    : args[1] === 'allow-vouched' ? { out: JSON.stringify({ allowed: false, acked: false, reason: 'ambiguous', because: 'x' }) } : { out: '{}' });
  remote.vouchPatchForTests({ retryAt: 0 });
  remote.vouchTickForTests(); await settle();
  assert.equal(remote.vouchSecretForTests(), null, 'a leaked S was kept');
});


/* c3 review 1: a secret retired while the waiting list was being read is never used; only vouched rows are offered; a
   device Kosmos+ does not know is taken back; each link mints its own S; a Not me that loses the race takes it back. */
function heldWaiting(rowsJson) {
  let release;
  const held = new Promise((r) => { release = r; });
  let first = true;
  return { release, answer: (args) => {
    if (args[1] === 'waiting') { const out = JSON.stringify(rowsJson); if (first) { first = false; return { out, wait: held }; } return { out }; }
    if (args[1] === 'allow-vouched') return { out: JSON.stringify({ allowed: true, device_id: 'dstale', acked: true }) };
    return { out: '{}' };
  } };
}
const avRuns = () => devicesCalls().filter((a) => a[1] === 'allow-vouched').length;

test('c3 review 1: switched off, or the epoch moved, while the list was read: the old S is never used', async () => {
  for (const interrupt of [() => remote.setOn(false), () => remote.bumpSelfEpochForTests()]) {
    armVouch();
    remote.vouchTickForTests();   // opens
    const h = heldWaiting({ count: 1, waiting: [VROW(KNOCK)] });
    answer = h.answer;
    remote.vouchTickForTests();
    await new Promise((r) => setTimeout(r, 10));
    interrupt();
    h.release();
    await settle();
    assert.equal(avRuns(), 0, 'a retired secret was used: ' + interrupt.toString());
    assert.ok(!(remote.read().vouched || {}).dstale, 'a device was noted on a retired secret');
  }
});

test('c3 review 1: a waiting row without a vouch is never offered', async () => {
  armVouch();
  remote.vouchTickForTests();
  answer = (args) => (args[1] === 'waiting' ? { out: JSON.stringify({ count: 1, waiting: [{ ...VROW(KNOCK), vouched: false }] }) } : { out: '{}' });
  remote.vouchTickForTests(); await settle();
  assert.equal(avRuns(), 0);
});

test('c3 review 1: a device Kosmos+ does not know is taken back out, and not noted', async () => {
  armVouch();
  remote.vouchTickForTests();
  answer = (args) => (args[1] === 'waiting' ? { out: JSON.stringify({ count: 1, waiting: [VROW(KNOCK)] }) }
    : args[1] === 'allow-vouched' ? { out: JSON.stringify({ allowed: true, device_id: 'dunknown', acked: false, account_ack: 'unknown_device' }) }
      : args[1] === 'remove' ? { out: JSON.stringify({ device_id: 'dunknown', removed: true }) } : { out: '{}' });
  remote.vouchTickForTests(); await settle();
  assert.ok(devicesCalls().some((a) => a[1] === 'remove' && a.includes('dunknown')), 'not taken back');
  assert.ok(!(remote.read().vouched || {}).dunknown, 'noted though Kosmos+ does not know it');
});

test('c3 review 1: each link mints its own secret', () => {
  armVouch();
  const a = remote.startVouchForTests();
  const b = remote.startVouchForTests();
  assert.ok(a && b && a !== b, 'a secret was reused across links');
});

test('c3 review 1: Not me that loses the race to an Allow takes the browser back out; a later vouch answer does not note it', async () => {
  armVouch();
  answer = (args) => (args[1] === 'drop-waiting' ? { out: JSON.stringify({ dropped: 1, allowed: true, device_id: 'draced' }) }
    : args[1] === 'remove' ? { out: JSON.stringify({ device_id: 'draced', removed: true }) } : { out: '{}' });
  const d = await remote.deviceDropWaiting(KNOCK);
  assert.deepEqual([d.data.allowed, d.data.takenBack], [true, true]);
  assert.ok(devicesCalls().some((a) => a[1] === 'remove' && a.includes('draced')), 'the browser was not taken back');
  remote.vouchTickForTests();   // opens
  answer = (args) => (args[1] === 'waiting' ? { out: JSON.stringify({ count: 1, waiting: [VROW(DASHED)] }) }
    : args[1] === 'allow-vouched' ? { out: JSON.stringify({ allowed: true, device_id: 'draced', acked: true }) } : { out: '{}' });
  await new Promise((r) => setTimeout(r, 2100));
  remote.vouchTickForTests(); await settle();
  assert.equal(avRuns(), 1, 'premise: the vouch answer arrived');
  assert.ok(!(remote.read().vouched || {}).draced, 'a browser the person said Not me to was noted as connected');
});
