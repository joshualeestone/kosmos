'use strict';
/**
 * kosmos#4794 slice 1, the app's wiring for pairing two computers with a code both screens show. Every tunnel call goes
 * to a FAKE binary through AGENT_WORKFORCE_TUNNEL_BIN; nothing reaches a network.
 *  - pendingDevices passes code_wait only from the fixed list;
 *  - deviceAllow sends --code for a six-digit code (and never anything else), and words the tunnel's sas_mismatch and
 *    sas_pending refusals as code_changed / code_pending;
 *  - joinStatus hands the page only checked fields, and answers supported:false for a tunnel with no join verb;
 *  - joinConfirm refuses a code that is not six digits without spawning, and passes the tunnel's answer through.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-joincode-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const DATA_ROOT = require('./store').ROOT;
const FAKE_BIN = nodePath.join(SANDBOX, 'fake-kosmos-tunnel');
const RECORD = nodePath.join(SANDBOX, 'fake-record.jsonl');
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_BIN;
process.env.AGENT_WORKFORCE_TUNNEL_RELAY = 'relay.test:443';

/* The fake speaks the join and allow contract as kosmos-relay's crates/tunnel prints it (pairing.rs, devices.rs).
   FAKE_JOIN picks the join status shape; an allow's --code picks its refusal. */
fs.writeFileSync(FAKE_BIN, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(RECORD)}, JSON.stringify(args) + '\\n');
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const mode = process.env.FAKE_JOIN || '';
if (args[0] === 'devices' && args[1] === 'allow') {
  if (flag('--code') === '111111') { process.stderr.write('Error: sas_mismatch: the code given is not the code this computer shows now; compare the screens again\\n'); process.exit(1); }
  if (flag('--code') === '222222') { process.stderr.write('Error: sas_pending: the code to compare is not worked out yet; wait for it on both screens, then allow\\n'); process.exit(1); }
  if (flag('--code') === '333333') { process.stderr.write('Error: the coordinator is unreachable\\n'); process.exit(1); }
  console.log(JSON.stringify({ allowed: true }));
  process.exit(0);
}
if (args[0] === 'join') {
  if (mode === 'unsupported') { process.stderr.write("error: unrecognized subcommand 'join'\\n"); process.exit(2); }
  if (args[1] === 'status') {
    if (mode === 'shape') console.log(JSON.stringify({ held: true, join_code: '482915', join_codes: [{ on: 'HomeMac', code: '482915' }, { on: '<b>x</b>', code: '1' }],
      asked_of: ['HomeMac', '<script>', 'ok-name'], failed: 'yes', confirmed: false, confirm_expired: true, secret: 'not for the page' }));
    else if (mode === 'badcode') console.log(JSON.stringify({ held: true, join_code: 'AB-12', join_codes: [], asked_of: [] }));
    else console.log(JSON.stringify({ held: false, join_code: '', join_codes: [], asked_of: [], failed: false, confirmed: false, confirm_expired: false }));
    process.exit(0);
  }
  if (args[1] === 'confirm') {
    if (flag('--code') === '482915') { console.log(JSON.stringify({ confirmed: true, with: 'HomeMac' })); process.exit(0); }
    process.stderr.write('Error: sas_mismatch: that is not the code this computer shows\\n'); process.exit(1);
  }
}
process.stderr.write('fake: unexpected ' + args.join(' ') + '\\n');
process.exit(9);
`, { mode: 0o755 });

const remote = require('./remote');

function enrol() {
  const dir = nodePath.join(DATA_ROOT, 'remote');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(nodePath.join(dir, f), 'fake');
  return dir;
}
function unenrol() { fs.rmSync(nodePath.join(DATA_ROOT, 'remote'), { recursive: true, force: true }); }
function recorded() {
  try { return fs.readFileSync(RECORD, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; }
}
test.beforeEach(() => { fs.rmSync(RECORD, { force: true }); delete process.env.FAKE_JOIN; });
test.afterEach(() => { remote.resetForTests(); unenrol(); });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#4794: a pending row passes code_wait only from the fixed list', () => {
  const dir = enrol();
  fs.writeFileSync(nodePath.join(dir, 'pending.json'), JSON.stringify({ devices: [
    { device_id: 'dev-a', name: 'laptop', first_seen: 1756000000, code: '', joining_computer: 'laptop', code_wait: 'daily_limit' },
    { device_id: 'dev-b', name: 'laptop2', first_seen: 1756000000, code: '', joining_computer: 'laptop2', code_wait: '<b>bad</b>' },
    { device_id: 'dev-c', name: 'laptop3', first_seen: 1756000000, code: '482915', joining_computer: 'laptop3' },
  ] }));
  remote.setOn(true);
  const by = Object.fromEntries(remote.pendingDevices().devices.map((d) => [d.device_id, d.code_wait]));
  assert.deepEqual(by, { 'dev-a': 'daily_limit', 'dev-b': null, 'dev-c': null });
});

test('#4794: Allow sends a six-digit code with --code, and nothing for anything else', async () => {
  enrol();
  assert.equal((await remote.deviceAllow('dev-1', 'laptop', '482915')).ok, true);
  assert.equal((await remote.deviceAllow('dev-2', 'iPhone', 'K7-4M')).ok, true);
  assert.equal((await remote.deviceAllow('dev-3', 'iPhone')).ok, true);
  const calls = recorded().filter((a) => a[0] === 'devices' && a[1] === 'allow');
  const codeOf = (id) => { const c = calls.find((a) => a[a.indexOf('--device-id') + 1] === id); assert.ok(c, id + ' never reached the binary'); return c.includes('--code') ? c[c.indexOf('--code') + 1] : null; };
  assert.equal(codeOf('dev-1'), '482915');
  assert.equal(codeOf('dev-2'), null, "a phone's letter code reached --code");
  assert.equal(codeOf('dev-3'), null);
});

test("#4794: the tunnel's pairing refusals are worded as code_changed / code_pending; any other failure keeps its own reason", async () => {
  enrol();
  const changed = await remote.deviceAllow('dev-1', 'laptop', '111111');
  assert.deepEqual([changed.ok, changed.because], [false, 'code_changed']);
  const pending = await remote.deviceAllow('dev-1', 'laptop', '222222');
  assert.deepEqual([pending.ok, pending.because], [false, 'code_pending']);
  const other = await remote.deviceAllow('dev-1', 'laptop', '333333');
  assert.equal(other.ok, false);
  assert.notEqual(other.because, 'code_changed');
  assert.notEqual(other.because, 'code_pending');
});

test('#4794: join status hands the page only checked fields', async () => {
  enrol();
  process.env.FAKE_JOIN = 'shape';
  const got = await remote.joinStatus();
  assert.equal(got.ok, true, got.because);
  assert.deepEqual(got.data, { supported: true, held: true, join_code: '482915', on: 'homemac', asked_of: ['homemac', 'ok-name'],
    failed: false, confirmed: false, confirm_expired: true });
  const call = recorded().find((a) => a[0] === 'join' && a[1] === 'status');
  assert.ok(call && call.includes('--coordinator') && call.includes('--state-dir'), JSON.stringify(call));
});

test('#4794: a code that is not six digits never reaches the page', async () => {
  enrol();
  process.env.FAKE_JOIN = 'badcode';
  const got = await remote.joinStatus();
  assert.equal(got.data.join_code, '');
});

test('#4794: a tunnel with no join verb answers supported:false, not an error', async () => {
  enrol();
  process.env.FAKE_JOIN = 'unsupported';
  const got = await remote.joinStatus();
  assert.deepEqual(got, { ok: true, because: null, data: { supported: false, held: false } });
});

test('#4794: not enrolled is not joining, and the binary is not asked', async () => {
  const got = await remote.joinStatus();
  assert.deepEqual(got.data, { supported: true, held: false });
  assert.equal(recorded().length, 0);
});

test('#4794: The codes match passes the code to join confirm and answers the other computer', async () => {
  enrol();
  const ok = await remote.joinConfirm('482915');
  assert.deepEqual(ok, { ok: true, because: null, data: { confirmed: true, with: 'homemac' } });
  const call = recorded().find((a) => a[0] === 'join' && a[1] === 'confirm');
  assert.equal(call[call.indexOf('--code') + 1], '482915');
  assert.ok(!call.includes('--coordinator'), 'join confirm is local only');
  const wrong = await remote.joinConfirm('123456');
  assert.equal(wrong.ok, false);
});

test('#4794: a confirm code that is not six digits is refused without spawning', async () => {
  enrol();
  for (const bad of ['12345', 'AB-12', '', '1234567', null]) {
    const r = await remote.joinConfirm(bad);
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(recorded().length, 0, 'a bad code reached the binary');
});
