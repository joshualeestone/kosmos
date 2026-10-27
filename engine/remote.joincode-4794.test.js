'use strict';
/**
 * kosmos#4794 slice 1, the app's wiring for pairing two computers with a code both screens show. Every tunnel call goes
 * to a FAKE binary through AGENT_WORKFORCE_TUNNEL_BIN; nothing reaches a network.
 *  - pendingDevices passes code_wait only from the fixed list;
 *  - deviceAllow sends --code for a six-digit code (and never anything else), and tags the tunnel's refusals:
 *    code_many (more than one computer showing a code), code_changed, code_pending; joinConfirm tags code_expired;
 *  - joinStatus hands the page only checked fields (its JSON read past the tunnel's log lines), and answers
 *    supported:false for a tunnel with no join verb;
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
  if (flag('--code') === '111 111') { process.stderr.write('Error: sas_mismatch: the code given is not the code this computer shows now; compare the screens again\\n'); process.exit(1); }
  if (flag('--code') === '222 222') { process.stderr.write('Error: sas_pending: the code to compare is not worked out yet; wait for it on both screens, then allow\\n'); process.exit(1); }
  if (flag('--code') === '444 444') { process.stderr.write('Error: sas_mismatch: more than one computer is showing a code; Deny the ones you do not recognise\\n'); process.exit(1); }
  if (flag('--code') === '333 333') { process.stderr.write('Error: the coordinator is unreachable\\n'); process.exit(1); }
  console.log(JSON.stringify({ allowed: true }));
  process.exit(0);
}
if (args[0] === 'devices' && args[1] === 'list' && process.env.FAKE_LIST) {   // #6315: the allowed list
  console.log(process.env.FAKE_LIST);
  process.exit(0);
}
if (args[0] === 'join') {
  if (mode === 'unsupported') { process.stderr.write("error: unrecognized subcommand 'join'\\n"); process.exit(2); }
  if (args[1] === 'status') {
    /* The real tunnel logs to stdout before its JSON line (main.rs tracing, step()'s warnings). */
    console.log('2026-10-03T05:00:00Z  WARN kosmos_tunnel::pairing: a round met a busy lock { "noise": true }');
    if (mode === 'shape') console.log(JSON.stringify({ held: true, join_code: '482 915', join_codes: [{ on: 'HomeMac', code: '482 915' }, { on: '<b>x</b>', code: '1' }],
      asked_of: ['HomeMac', '<script>', 'ok-name'], failed: 'yes', confirmed: false, confirm_expired: true, needs_retry: true, secret: 'not for the page' }));
    else if (mode === 'badcode') console.log(JSON.stringify({ held: true, join_code: 'AB-12', join_codes: [], asked_of: [] }));
    else if (mode === 'recheck-status') console.log(JSON.stringify({ held: false, join_code: '', join_codes: [], asked_of: [], failed: false, confirmed: false,
      confirm_expired: true, needs_retry: false, can_recheck: true, rechecking: false, recheck_with: 'HomeMac' }));
    else if (mode === 'recheck-badname') console.log(JSON.stringify({ held: false, join_code: '', join_codes: [], asked_of: [], can_recheck: 'yes', rechecking: 1, recheck_with: '<b>x</b>' }));
    else console.log(JSON.stringify({ held: false, join_code: '', join_codes: [], asked_of: [], failed: false, confirmed: false, confirm_expired: false }));
    process.exit(0);
  }
  if (args[1] === 'retry') {   // #6353
    if (mode === 'retry-old') { process.stderr.write("error: unrecognized subcommand 'retry'\\n"); process.exit(2); }
    if (mode === 'retry-none') { process.stderr.write('Error: nothing_to_retry: there is no code that ran out here\\n'); process.exit(1); }
    if (mode === 'retry-used') { process.stderr.write('Error: attempts_used: every try is used; press Not me on the other computer, then set this one up again\\n'); process.exit(1); }
    console.log(JSON.stringify({ retry: true })); process.exit(0);
  }
  if (args[1] === 'recheck') {   // kosmos#6404
    if (mode === 'recheck-old') { process.stderr.write("error: unrecognized subcommand 'recheck'\\n"); process.exit(2); }
    if (mode === 'recheck-none') { process.stderr.write('Error: nothing_to_recheck: there is no code to check again here\\n'); process.exit(1); }
    if (mode === 'recheck-used') { process.stderr.write('Error: attempts_used: every try is used; press Not me on the other computer, then set this one up again\\n'); process.exit(1); }
    console.log(JSON.stringify({ recheck: true })); process.exit(0);
  }
  if (args[1] === 'confirm') {
    if (flag('--code') === '482 915') { console.log(JSON.stringify({ confirmed: true, with: 'HomeMac' })); process.exit(0); }
    if (flag('--code') === '000 001') { process.stderr.write('Error: sas_pending: that code has expired; a new one is worked out while this computer waits\\n'); process.exit(1); }
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
test.beforeEach(() => { fs.rmSync(RECORD, { force: true }); delete process.env.FAKE_JOIN; delete process.env.FAKE_LIST; });
test.afterEach(() => { remote.resetForTests(); unenrol(); });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#4794: a pending row passes code_wait only from the fixed list', () => {
  const dir = enrol();
  fs.writeFileSync(nodePath.join(dir, 'pending.json'), JSON.stringify({ devices: [
    { device_id: 'dev-a', name: 'laptop', first_seen: 1756000000, code: '', joining_computer: 'laptop', code_wait: 'daily_limit' },
    { device_id: 'dev-b', name: 'laptop2', first_seen: 1756000000, code: '', joining_computer: 'laptop2', code_wait: '<b>bad</b>' },
    { device_id: 'dev-c', name: 'laptop3', first_seen: 1756000000, code: '482 915', joining_computer: 'laptop3' },
    // #6383: the tunnel's reason for a code that ran out on the joining computer.
    { device_id: 'dev-d', name: 'laptop4', first_seen: 1756000000, code: '', joining_computer: 'laptop4', code_wait: 'code_ran_out' },
  ] }));
  remote.setOn(true);
  const by = Object.fromEntries(remote.pendingDevices().devices.map((d) => [d.device_id, d.code_wait]));
  assert.deepEqual(by, { 'dev-a': 'daily_limit', 'dev-b': null, 'dev-c': null, 'dev-d': 'code_ran_out' });
});

test('#4794: Allow sends a six-digit code with --code, and nothing for anything else', async () => {
  enrol();
  assert.equal((await remote.deviceAllow('dev-1', 'laptop', '482 915')).ok, true);
  assert.equal((await remote.deviceAllow('dev-2', 'iPhone', 'K7-4M')).ok, true);
  assert.equal((await remote.deviceAllow('dev-3', 'iPhone')).ok, true);
  const calls = recorded().filter((a) => a[0] === 'devices' && a[1] === 'allow');
  const codeOf = (id) => { const c = calls.find((a) => a[a.indexOf('--device-id') + 1] === id); assert.ok(c, id + ' never reached the binary'); return c.includes('--code') ? c[c.indexOf('--code') + 1] : null; };
  assert.equal(codeOf('dev-1'), '482 915');
  assert.equal(codeOf('dev-2'), null, "a phone's letter code reached --code");
  assert.equal(codeOf('dev-3'), null);
});

test("#4794: the tunnel's pairing refusals are worded as code_changed / code_pending; any other failure keeps its own reason", async () => {
  enrol();
  const changed = await remote.deviceAllow('dev-1', 'laptop', '111 111');
  assert.deepEqual([changed.ok, changed.because], [false, 'code_changed']);
  const pending = await remote.deviceAllow('dev-1', 'laptop', '222 222');
  assert.deepEqual([pending.ok, pending.because], [false, 'code_pending']);
  const many = await remote.deviceAllow('dev-1', 'laptop', '444 444');
  assert.deepEqual([many.ok, many.because], [false, 'code_many']);
  const other = await remote.deviceAllow('dev-1', 'laptop', '333 333');
  assert.equal(other.ok, false);
  assert.notEqual(other.because, 'code_changed');
  assert.notEqual(other.because, 'code_pending');
});

test('#4794: join status hands the page only checked fields', async () => {
  enrol();
  process.env.FAKE_JOIN = 'shape';
  const got = await remote.joinStatus();
  assert.equal(got.ok, true, got.because);
  assert.deepEqual(got.data, { supported: true, held: true, join_code: '482 915', on: 'homemac', asked_of: ['homemac', 'ok-name'],
    failed: false, confirmed: false, confirm_expired: true, needs_retry: true, can_recheck: false, rechecking: false, recheck_with: null });
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
  const ok = await remote.joinConfirm('482 915');
  assert.deepEqual(ok, { ok: true, because: null, data: { confirmed: true, with: 'homemac' } });
  const call = recorded().find((a) => a[0] === 'join' && a[1] === 'confirm');
  assert.equal(call[call.indexOf('--code') + 1], '482 915');
  assert.ok(!call.includes('--coordinator'), 'join confirm is local only');
  const wrong = await remote.joinConfirm('123 456');
  assert.deepEqual([wrong.ok, wrong.because], [false, 'code_changed'], 'a mismatch is tagged for the page, not relayed raw');
  const expired = await remote.joinConfirm('000 001');
  assert.deepEqual([expired.ok, expired.because], [false, 'code_expired'], 'an expired code is tagged for the page');
});

test('#6353: Try again runs join retry locally and tags the tunnel refusals for the page', async () => {
  enrol();
  const ok = await remote.joinRetry();
  assert.deepEqual(ok, { ok: true, because: null, data: { retry: true } });
  const call = recorded().find((a) => a[0] === 'join' && a[1] === 'retry');
  assert.ok(call && call.includes('--state-dir'), JSON.stringify(call));
  assert.ok(!call.includes('--coordinator'), 'join retry is local only');
  process.env.FAKE_JOIN = 'retry-none';
  assert.deepEqual(await remote.joinRetry(), { ok: false, because: 'nothing_to_retry' });
  process.env.FAKE_JOIN = 'retry-used';
  assert.deepEqual(await remote.joinRetry(), { ok: false, because: 'attempts_used' });
  process.env.FAKE_JOIN = 'unsupported';
  assert.match((await remote.joinRetry()).because, /cannot pair computers yet/);
  process.env.FAKE_JOIN = 'retry-old';   // a tunnel with join but from before join retry: it can pair, not take Try again
  assert.equal((await remote.joinRetry()).because, 'this version of Kosmos cannot ask for a new code yet');
});

test('kosmos#6404: Check the code runs join recheck locally and tags the tunnel refusals for the page', async () => {
  enrol();
  process.env.FAKE_JOIN = '';
  assert.deepEqual(await remote.joinRecheck(), { ok: true, because: null, data: { recheck: true } });
  const call = recorded().find((a) => a[0] === 'join' && a[1] === 'recheck');
  assert.ok(call && call.includes('--state-dir'), JSON.stringify(call));
  assert.ok(!call.includes('--coordinator'), 'join recheck is local only');
  process.env.FAKE_JOIN = 'recheck-none';
  assert.deepEqual(await remote.joinRecheck(), { ok: false, because: 'nothing_to_recheck' });
  process.env.FAKE_JOIN = 'recheck-used';
  assert.deepEqual(await remote.joinRecheck(), { ok: false, because: 'attempts_used' });
  process.env.FAKE_JOIN = 'recheck-old';   // a tunnel from before join recheck
  assert.equal((await remote.joinRecheck()).because, 'this version of Kosmos cannot check the code again yet');
  process.env.FAKE_JOIN = '';
});

test('kosmos#6404: join status passes the check fields, typed, and the name through the name rule', async () => {
  enrol();
  process.env.FAKE_JOIN = 'recheck-status';
  const ok = await remote.joinStatus();
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual([ok.data.can_recheck, ok.data.rechecking, ok.data.recheck_with, ok.data.confirm_expired], [true, false, 'homemac', true]);
  process.env.FAKE_JOIN = 'recheck-badname';   // CONTROL: not booleans, a name that breaks the rule
  const bad = await remote.joinStatus();
  assert.deepEqual([bad.data.can_recheck, bad.data.rechecking, bad.data.recheck_with], [false, false, null]);
  process.env.FAKE_JOIN = '';
});

test('#6353: Try again before the sign-up is finished does not reach the binary', async () => {
  const r = await remote.joinRetry();
  assert.deepEqual(r, { ok: false, because: 'finish the Plus sign-up first' });
  assert.equal(recorded().length, 0);
});

test('#4794: join confirm on a tunnel with no join verb says so in words', async () => {
  enrol();
  process.env.FAKE_JOIN = 'unsupported';
  const r = await remote.joinConfirm('482 915');
  assert.equal(r.ok, false);
  assert.match(r.because, /cannot pair computers yet/);
});

test('#4794: a confirm code that is not six digits is refused without spawning', async () => {
  enrol();
  /* '482915' is six digits with no space: the tunnel's code is "482 915" (pairsas.rs) and it compares exactly. */
  for (const bad of ['12345', 'AB-12', '', '1234567', '482915', '482  915', null]) {
    const r = await remote.joinConfirm(bad);
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(recorded().length, 0, 'a bad code reached the binary');
});

/* #6315: the coordinator names a joining computer's request by a MINTED id, computer:<the computer's 32-hex id>
   (kosmos-relay MINTED_PREFIX, kosmos#4681). Every test above used ids like 'dev-a', so nothing saw that the board's
   id check refused the colon and dropped every such request: no second computer could ever be allowed. */
const MINTED = 'computer:36b705ae542a7305ca8a368286c37161';

test('#6315: a joining computer named by its real minted id is listed, with its name and code; malformed ones are not', () => {
  const dir = enrol();
  fs.writeFileSync(nodePath.join(dir, 'pending.json'), JSON.stringify({ devices: [
    { device_id: MINTED, name: 'computer tmnt', first_seen: 1792168082, code: '050 584', joining_computer: 'tmnt' },
    { device_id: 'computer:36B705AE542A7305CA8A368286C37161', name: 'upper', first_seen: 1792168082, code: '', joining_computer: 'upper' },
    { device_id: 'computer:36b705ae542a7305ca8a368286c3716', name: 'short', first_seen: 1792168082, code: '', joining_computer: 'short' },
    { device_id: 'computer:../../etc', name: 'path', first_seen: 1792168082, code: '', joining_computer: 'path' },
    { device_id: 'k1.L8xHhgKw4ciSy7mTPfT3qNu8V7Z2oDAn', name: 'Android phone', first_seen: 1792009447, code: '' },   // CONTROL
  ] }));
  remote.setOn(true);
  const got = remote.pendingDevices().devices;
  assert.deepEqual(got.map((d) => d.device_id), [MINTED, 'k1.L8xHhgKw4ciSy7mTPfT3qNu8V7Z2oDAn']);
  const row = got.find((d) => d.device_id === MINTED);
  assert.equal(row.joining_computer, 'tmnt');
  assert.equal(row.code, '050 584');
});

test('#6315: Allow takes the minted id and hands it to the tunnel unchanged; a malformed computer id is refused', async () => {
  enrol();
  const ok = await remote.deviceAllow(MINTED, 'tmnt', '050 584');
  assert.equal(ok.ok, true, ok.because);
  const call = recorded().filter((a) => a[0] === 'devices' && a[1] === 'allow').find((a) => a[a.indexOf('--device-id') + 1] === MINTED);
  assert.ok(call, 'the minted id never reached the tunnel');
  assert.equal(call[call.indexOf('--code') + 1], '050 584');
  const before = recorded().length;
  for (const near of ['computer:' + 'A'.repeat(32), 'computer:' + 'a'.repeat(31), 'computer:' + 'a'.repeat(33)]) {
    const bad = await remote.deviceAllow(near, 'tmnt', '050 584');
    assert.deepEqual([bad.ok, bad.because], [false, 'that is not a device we know'], near);
  }
  assert.equal(recorded().length, before, 'a near-miss computer id reached the tunnel');
});

test('#6315: a computer id is never allowed without the code both screens show', async () => {
  enrol();
  for (const code of [undefined, '', 'K7-4M']) {
    const r = await remote.deviceAllow(MINTED, 'tmnt', code);
    assert.deepEqual([r.ok, r.because], [false, 'code_pending'], 'a computer was allowed, or refused in unworded terms, with code ' + JSON.stringify(code));
  }
  assert.equal(recorded().filter((a) => a[0] === 'devices' && a[1] === 'allow').length, 0, 'a code-less computer Allow reached the tunnel');
});

test('#6315: Not me and Remove take the minted id too', async () => {
  enrol();
  await remote.deviceDeny(MINTED);
  await remote.deviceRemove(MINTED);
  const verbs = recorded().filter((a) => a[0] === 'devices' && a[a.indexOf('--device-id') + 1] === MINTED).map((a) => a[1]);
  assert.ok(verbs.includes('deny'), 'Not me on the minted id never reached the tunnel: ' + JSON.stringify(verbs));
  assert.ok(verbs.includes('remove'), 'Remove on the minted id never reached the tunnel: ' + JSON.stringify(verbs));
});

test('#6315: a computer: row with no usable computer name is shown as a former computer, never as a phone', () => {
  const dir = enrol();
  fs.writeFileSync(nodePath.join(dir, 'pending.json'), JSON.stringify({ devices: [
    { device_id: MINTED, name: 'computer tmnt', first_seen: 1792168082, code: 'K7-4M', joining_computer: null },
  ] }));
  remote.setOn(true);
  const [row] = remote.pendingDevices().devices;
  assert.deepEqual([row.device_id, row.code, row.code_wait], [MINTED, '', 'was_a_computer']);
  // A more specific reason is kept, not overwritten (a defensive case: today's tunnel sends one only with a name).
  fs.writeFileSync(nodePath.join(dir, 'pending.json'), JSON.stringify({ devices: [
    { device_id: MINTED, name: 'computer tmnt', first_seen: 1792168082, code: '', joining_computer: null, code_wait: 'daily_limit' },
  ] }));
  assert.equal(remote.pendingDevices().devices[0].code_wait, 'daily_limit');
});

test('#6315: the allowed list keeps a computer: id, so it can be removed', async () => {
  enrol();
  process.env.FAKE_LIST = JSON.stringify({ devices: [
    { device_id: MINTED, name: 'computer tmnt', allowed_at: 1792168200, last_seen: 0 },
    { device_id: 'computer:' + 'a'.repeat(31), name: 'short', allowed_at: 1792168200, last_seen: 0 },
  ] });
  const got = await remote.devicesList();
  assert.equal(got.ok, true, got.because);
  assert.deepEqual(got.data.devices.map((d) => d.device_id), [MINTED]);
});

test('#7285 follow-up: the allowed list carries every key holding each id ([] when none), for the cloud own-device guard', async () => {
  enrol();
  const other = 'computer:' + 'b'.repeat(32);
  process.env.FAKE_LIST = JSON.stringify({ devices: [
    { device_id: MINTED, name: 'computer tmnt', allowed_at: 1792168200, last_seen: 0, keys: ['k1.first', 'k1.second'] },
    { device_id: other, name: 'computer two', allowed_at: 1792168200, last_seen: 0 },
  ] });
  const got = await remote.devicesList();
  assert.equal(got.ok, true, got.because);
  assert.deepEqual(got.data.devices.map((d) => [d.device_id, d.keys]), [[MINTED, ['k1.first', 'k1.second']], [other, []]]);
  // Review 2: junk entries are dropped, so an empty header piece can never match one; a non-array reads as none.
  process.env.FAKE_LIST = JSON.stringify({ devices: [
    { device_id: MINTED, name: 'computer tmnt', allowed_at: 1792168200, last_seen: 0, keys: ['', 7, null, 'k1.ok'] },
    { device_id: other, name: 'computer two', allowed_at: 1792168200, last_seen: 0, keys: 'k1.ok' },
  ] });
  const junk = await remote.devicesList();
  assert.deepEqual(junk.data.devices.map((d) => d.keys), [['k1.ok'], []]);
});
