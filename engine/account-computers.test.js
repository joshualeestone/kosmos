'use strict';

/**
 * kosmos#4648: engine/account-computers.js, the board-side read of the computers on
 * this Kosmos+ account, SIGNED through the tunnel's `mac-request` verb, plus the
 * online probe.
 *
 *   node --test engine/account-computers.test.js
 *
 * The tunnel binary is FAKED (test-support/fake-mac-request.js), as in
 * engine/mac-standing.test.js: enrolment, the switch gate, remote.macRequest's argv
 * and stdin and the answer parsing run for real. The online probe is injected in the
 * fetch arms and driven against a local server in its own arms.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { makeFakeTunnel, tripwire } = require('../test-support/fake-mac-request');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acctcomputers-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acctcomputers-state-'));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://login.kosmos.test';
const fake = makeFakeTunnel();
process.env.AGENT_WORKFORCE_TUNNEL_BIN = fake.bin;
const remote = require('../engine/remote');
const ac = require('../engine/account-computers');

function enroll(on) {
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
  fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
  fs.writeFileSync(remote.FILE, JSON.stringify({ on: on !== false, standing: '' }) + '\n');
}
function unenroll() { for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) { try { fs.rmSync(path.join(STATE, f), { force: true }); } catch { /* ignore */ } } }

async function run(mode, fn) {
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = mode;
  const wire = tripwire();
  try {
    const value = await fn();
    return { value, calls: fake.calls(), dialled: wire.dialled };
  } finally {
    wire.restore();
    delete process.env.FAKE_MAC_REQUEST_MODE;
  }
}

const ANSWER = {
  computers: [
    { name: 'pizzarama', address: 'pizzarama.kosmos.test', last_seen: 1, this: false },
    { name: 'laptop', address: 'laptop.kosmos.test', last_seen: 2, this: true },
    { name: 'agent1s', address: 'agent1s.kosmos.test', last_seen: 3, this: false, updating_until: 9e9 },
  ],
};

test('computerDomain: one label under the sign-in host\'s parent, as the native app derives it; too short is null', () => {
  assert.equal(ac.computerDomain('https://login.kosmosplus.com'), 'kosmosplus.com');
  assert.equal(ac.computerDomain('https://login.kosmos.test/'), 'kosmos.test');
  assert.equal(ac.computerDomain('https://coord.example'), null, 'two labels: no parent to trust');
  assert.equal(ac.computerDomain('not a url'), null);
});

test('validAddress: exactly one plain label under the computers\' domain; any other host, a LAN address, a scheme, a path or punycode is refused', () => {
  const D = 'kosmos.test';
  assert.equal(ac.validAddress('agent1s.kosmos.test', D), true);
  assert.equal(ac.validAddress('a-b-1.kosmos.test', D), true);
  for (const bad of ['evil.example', '10.0.0.1', '127.0.0.1', '192.168.1.1', 'a.b.kosmos.test', 'kosmos.test', '.kosmos.test',
    'https://x.kosmos.test', 'x.kosmos.test/evil', 'x.kosmos.test:444', 'me@x.kosmos.test', 'x .kosmos.test', 'xn--pple-43d.kosmos.test',
    '-x.kosmos.test', 'x-.kosmos.test', 'X.kosmos.test', 'x.kosmos.test.evil.example', '', null, 42]) {
    assert.equal(ac.validAddress(bad, D), false, JSON.stringify(bad));
  }
  assert.equal(ac.validAddress('agent1s.kosmos.test', null), false, 'no domain: nothing is trusted');
});

test('parseComputers: keeps valid rows, drops a row with a bad address or no name, marks updating', () => {
  const rows = ac.parseComputers({ computers: [
    { name: 'ok', address: 'ok.kosmos.test', this: true },
    { name: 'evil', address: 'https://evil.example/x' },
    { name: 'lan', address: '10.0.0.1' },
    { name: 'elsewhere', address: 'evil.example' },
    { name: '', address: 'noname.kosmos.test' },
    { name: 'up', address: 'up.kosmos.test', updating_until: 5 },
    null,
  ] }, 'kosmos.test');
  assert.deepEqual(rows.map((r) => r.name), ['ok', 'up']);
  assert.equal(rows[0].this, true);
  assert.equal(rows[1].updating, true);
  assert.equal(ac.parseComputers({}, 'kosmos.test'), null);
  assert.equal(ac.parseComputers(null, 'kosmos.test'), null);
});

test('#4726 parseComputers: held is carried as a bool; absent (a coordinator before #4681) or anything but true reads as not held', () => {
  const rows = ac.parseComputers({ computers: [
    { name: 'waiting', address: 'waiting.kosmos.test', held: true },
    { name: 'allowed', address: 'allowed.kosmos.test', held: false },
    { name: 'old', address: 'old.kosmos.test' },
    { name: 'odd', address: 'odd.kosmos.test', held: 'true' },
  ] }, 'kosmos.test');
  assert.deepEqual(rows.map((r) => [r.name, r.held]), [['waiting', true], ['allowed', false], ['old', false], ['odd', false]]);
});

test('#4726 fetchComputers: a held computer is never probed and reads offline; the others are probed as before (control)', async () => {
  enroll(true);
  const probed = [];
  const probe = async (a) => { probed.push(a); return true; };
  const answer = { computers: [
    { name: 'laptop', address: 'laptop.kosmos.test', this: true, held: false },
    { name: 'waiting', address: 'waiting.kosmos.test', this: false, held: true },
    { name: 'allowed', address: 'allowed.kosmos.test', this: false, held: false },
  ] };
  const r = await run('ok:' + JSON.stringify(answer), () => ac.fetchComputers({ probe }));
  assert.equal(r.value.ok, true, JSON.stringify(r.value));
  assert.deepEqual(probed, ['allowed.kosmos.test'], 'a held computer was probed');
  const by = Object.fromEntries(r.value.computers.map((c) => [c.name, c]));
  assert.equal(by.waiting.held, true);
  assert.equal(by.waiting.online, false, 'a held computer reads online');
  assert.equal(by.allowed.online, true, 'CONTROL: an allowed computer is probed and can read online');
});

test('fetchComputers: SIGNED through the tunnel (one mac-request POST, no direct dial), this computer first and not probed, others probed', async () => {
  enroll(true);
  const probed = [];
  const probe = async (a) => { probed.push(a); return a.startsWith('agent1s'); };
  const r = await run('ok:' + JSON.stringify(ANSWER), () => ac.fetchComputers({ probe }));
  assert.equal(r.value.ok, true, JSON.stringify(r.value));
  assert.equal(r.value.domain, 'kosmos.test', 'the page needs the domain to re-check addresses');
  assert.equal(r.calls.length, 1, 'exactly one signed call');
  const c = r.calls[0];
  assert.equal(c.args[0], 'mac-request');
  assert.equal(fake.flag(c, '--method'), 'POST');
  assert.equal(fake.flag(c, '--path'), '/v1/mac/account-computers');
  assert.deepEqual(JSON.parse(c.stdin), {}, 'the body carries nothing: the signature says who is asking');
  assert.deepEqual(r.dialled, [], 'the board dialled the network itself instead of through the tunnel');
  assert.deepEqual(r.value.computers.map((c) => c.name), ['laptop', 'agent1s', 'pizzarama'], 'this computer first, then by name');
  assert.deepEqual(probed.sort(), ['agent1s.kosmos.test', 'pizzarama.kosmos.test'], 'this computer is never probed');
  const by = Object.fromEntries(r.value.computers.map((c) => [c.name, c]));
  assert.equal(by.laptop.online, true);
  assert.equal(by.agent1s.online, true);
  assert.equal(by.pizzarama.online, false);
  assert.equal(by.agent1s.updating, true);
});

test('fetchComputers: a row whose address is off the computers\' domain is dropped and NEVER probed (no probing a LAN or another host)', async () => {
  enroll(true);
  const probed = [];
  const answer = { computers: [ANSWER.computers[1], { name: 'lan', address: '10.0.0.1', this: false }, { name: 'elsewhere', address: 'evil.example', this: false }] };
  const r = await run('ok:' + JSON.stringify(answer), () => ac.fetchComputers({ probe: async (a) => { probed.push(a); return true; } }));
  assert.equal(r.value.ok, true);
  assert.deepEqual(r.value.computers.map((c) => c.name), ['laptop']);
  assert.deepEqual(probed, [], 'an off-domain address was probed');
});

test('fetchComputers: a probe that throws reads as offline, not as a failed list', async () => {
  enroll(true);
  const r = await run('ok:' + JSON.stringify(ANSWER), () => ac.fetchComputers({ probe: async () => { throw new Error('boom'); } }));
  assert.equal(r.value.ok, true);
  assert.deepEqual(r.value.computers.filter((c) => !c.this).map((c) => c.online), [false, false]);
});

test('fetchComputers: not signed in (switch off, or not enrolled) asks nothing and says why', async () => {
  enroll(false);
  let r = await run('ok:' + JSON.stringify(ANSWER), () => ac.fetchComputers({ probe: async () => true }));
  assert.equal(r.value.ok, false);
  assert.match(r.value.because, /not signed in to Kosmos\+/);
  assert.equal(r.calls.length, 0, 'a switched-off board must not call the coordinator');
  unenroll();
  enroll(true); unenroll();
  r = await run('ok:' + JSON.stringify(ANSWER), () => ac.fetchComputers({ probe: async () => true }));
  assert.equal(r.value.ok, false);
  assert.equal(r.calls.length, 0, 'an unenrolled board must not call the coordinator');
});

test('fetchComputers: an old connector, a refusal, or an answer with no list is { ok: false }, never a throw', async () => {
  enroll(true);
  for (const mode of ['old-tunnel', 'refused', 'garbage', 'ok:{"standing":"good"}']) {
    const r = await run(mode, () => ac.fetchComputers({ probe: async () => true }));
    assert.equal(r.value.ok, false, mode + ': ' + JSON.stringify(r.value));
    assert.equal(typeof r.value.because, 'string', mode);
  }
});

test('probeOnline: ANY HTTP answer is online (even a 404), a refused connection and a silent server are offline', async () => {
  // A server that answers 404: the relay forwarded, so the computer is up.
  const answering = http.createServer((q, s) => { s.statusCode = 404; s.end(); });
  await new Promise((r) => answering.listen(0, '127.0.0.1', r));
  // A server that accepts and never answers: the timeout decides.
  const silent = http.createServer(() => { /* never answer */ });
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  // A port with nothing on it: refused.
  const closed = http.createServer();
  await new Promise((r) => closed.listen(0, '127.0.0.1', r));
  const closedPort = closed.address().port;
  await new Promise((r) => closed.close(r));
  try {
    const opts = (port, timeoutMs) => ({ request: http.request, port, timeoutMs });
    assert.equal(await ac.probeOnline('127.0.0.1', opts(answering.address().port, 2000)), true);
    assert.equal(await ac.probeOnline('127.0.0.1', opts(closedPort, 2000)), false);
    // A hard race, so a probe that ignores its timeout fails here instead of hanging the file.
    let raceT;
    const bounded = await Promise.race([
      ac.probeOnline('127.0.0.1', opts(silent.address().port, 300)),
      new Promise((r) => { raceT = setTimeout(() => r('HUNG'), 2000); }),
    ]);
    clearTimeout(raceT);
    assert.equal(bounded, false, 'a silent server must read offline within its timeout, got ' + bounded);
  } finally {
    answering.close(); silent.closeAllConnections(); silent.close();
  }
});

test.after(() => {
  for (const d of [SANDBOX, STATE]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  fake.cleanup();   // the fake tunnel's own temp dir (the #4273 leak guard caught it on Mortals)
});
