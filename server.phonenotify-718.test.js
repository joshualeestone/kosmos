'use strict';

/**
 * #718: phone notifications, driven through the real board. What is guarded:
 *   - OFF by default, and while off NOTHING leaves the Mac: a counting sender
 *     sees zero sends for a needs_you and a reply, and the tunnel is never run.
 *     The same actions DO send once on (the control), so the zero is not vacuous.
 *   - Turning on mints the notify token through the tunnel's mac-request verb,
 *     with the body on stdin (never argv), and the token is never returned.
 *   - While on: a needs_you sends once on the change into needs_you (a repeat
 *     does not buzz again), a reply sends as `replied`, and the payload is
 *     exactly the coordinator's fields. The report's and the reply's words never
 *     leave.
 *   - The id sent is push's own, never ping.installId().
 *   - Turning off stops sending at once; a Mac not connected to Kosmos+ cannot
 *     turn it on.
 *
 *   node --test server.phonenotify-718.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-718pn-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const STATE = path.join(SANDBOX, 'remote');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coord.example.test/kosmos';

// A fake tunnel binary: records its argv and stdin, answers a minted token.
const TUNNEL_LOG = path.join(SANDBOX, 'tunnel.log');
const FAKE_TUNNEL = path.join(SANDBOX, 'fake-kosmos-tunnel');
const MINTED = 'knt1_testtoken0123456789';
fs.writeFileSync(FAKE_TUNNEL, `#!/bin/bash
{ printf 'ARGV:'; printf ' %s' "$@"; printf '\\nSTDIN:'; cat; printf '\\n'; } >> "${TUNNEL_LOG}"
printf '{"token":"${MINTED}"}\\n'
`, { mode: 0o755 });
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL;

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');
const sendertoken = require('./engine/sendertoken');
const selfreport = require('./engine/selfreport');
const phonenotify = require('./engine/phonenotify');
const ping = require('./engine/ping');
const projects = require('./engine/projects');

const WHO = 'leo';
let base;
const sent = [];

function enrol() {
  fs.mkdirSync(STATE, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
}
function unenrol() { fs.rmSync(STATE, { recursive: true, force: true }); }

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = false;
  phonenotify.setSender((url, headers, body) => sent.push({ url, headers, body: JSON.parse(body) }));
});
test.after(() => {
  phonenotify.setSender(null);
  phonenotify.setClock(null);
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
let fakeNow = 1e12;
test.beforeEach(() => {
  sent.length = 0;
  phonenotify.resetCooldownForTests();
  fakeNow += 60 * 60 * 1000;
  phonenotify.setClock(() => fakeNow);
  unenrol();
  fs.rmSync(TUNNEL_LOG, { force: true });
  try { fs.rmSync(selfreport.DIR, { recursive: true, force: true }); } catch { /* not there */ }
  try { fs.rmSync(sendertoken.DIR, { recursive: true, force: true }); } catch { /* not there */ }
});

async function call(method, p, { headers = {}, body } = {}) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: res.status, json, text };
}

function withLeo(fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  const tok = sendertoken.mint(WHO).token;
  return Promise.resolve().then(() => fn({ 'x-kosmos-agent-token': tok }))
    .finally(() => { sendertoken.revoke(WHO); messages.setRunner(null); board.restore(); });
}
const report = (h, state) => call('POST', '/api/report', { headers: h, body: { state, text: 'THE REPORT WORDS' } });
const reply = (h) => call('POST', '/api/reply', { headers: h, body: { text: 'THE REPLY WORDS' } });

test('OFF by default: nothing is sent and the tunnel never runs', async () => {
  enrol();
  const st = await call('GET', '/api/phone-notify');
  assert.equal(st.json.on, false, 'phone notifications must start off');
  assert.equal(st.json.connected, true);
  await withLeo(async (h) => {
    assert.equal((await report(h, 'needs_you')).json.recorded, true);
    assert.equal((await reply(h)).json.kept, true);
  });
  assert.equal(sent.length, 0, 'something left the Mac while phone notifications were off');
  assert.equal(fs.existsSync(TUNNEL_LOG), false, 'the tunnel ran while off');
});

test('OFF even with a token on disk: only an explicit on:true sends', async () => {
  enrol();
  // A token is held but the switch was never set, or the file is not a plain object.
  await withLeo(async (h) => {
    for (const content of [JSON.stringify({ notifyId: 'n1', token: 'knt1_heldtoken0123' }), '[1]', 'not json']) {
      fs.writeFileSync(path.join(STATE, 'phone-notify.json'), content);
      await report(h, 'needs_you'); await report(h, 'working'); await reply(h);
    }
  });
  assert.equal(sent.length, 0, 'sent without an explicit on:true');
});

test('turning on mints through mac-request, body on stdin, token never returned', async () => {
  enrol();
  const on = await call('PUT', '/api/phone-notify', { body: { on: true } });
  assert.equal(on.code, 200, on.text);
  assert.equal(on.json.on, true);
  assert.doesNotMatch(on.text, /knt1_/, 'the token leaked into the response');
  assert.equal(on.json.signinUrl, 'https://coord.example.test/kosmos/signin', 'the sign-in link dropped the self-hosted prefix');
  const log = fs.readFileSync(TUNNEL_LOG, 'utf8');
  assert.match(log, /ARGV: mac-request --coordinator https:\/\/coord\.example\.test\/kosmos --state-dir \S+ --method POST --path \/v1\/mac\/notify-credential\n/);
  const stdin = JSON.parse(log.split('STDIN:')[1]);
  assert.match(stdin.install_id, /^[0-9a-f-]{36}$/, 'the credential is not bound to a random push id');
  assert.notEqual(stdin.install_id, ping.installId(), 'push reused the install id promised never to leave the Mac');
  assert.doesNotMatch(log.split('STDIN:')[0], /install_id/, 'the body went on argv');
});

test('ON: needs_you sends once per change into it, reply sends replied, never the words', async () => {
  enrol();
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  await withLeo(async (h) => {
    await report(h, 'needs_you');
    await report(h, 'needs_you');   // still waiting: no second buzz
    assert.equal(sent.length, 1, 'a repeat needs_you buzzed again');
    await report(h, 'working');
    fakeNow += phonenotify.NEEDS_YOU_COOLDOWN_MS + 1;
    await report(h, 'needs_you');   // a new wait, past the cooldown: buzz
    assert.equal(sent.length, 2, 'a new needs_you after working did not send');
    await reply(h);
    assert.equal(sent.length, 3, 'a reply did not send');
  });
  const [first, , third] = sent;
  assert.equal(first.url, 'https://coord.example.test/kosmos/v1/mac/notify');
  assert.equal(first.headers['x-kosmos-notify-token'], MINTED);
  assert.deepEqual(Object.keys(first.body).sort(), ['agent', 'at', 'id', 'installId', 'kind', 'project', 'session']);
  assert.equal(first.body.kind, 'needs_you');
  assert.equal(first.body.session, WHO);
  assert.equal(third.body.kind, 'replied');
  const all = JSON.stringify(sent);
  assert.doesNotMatch(all, /THE REPORT WORDS|THE REPLY WORDS/, 'message words left the Mac');
  assert.equal(first.body.installId, phonenotify.readState().notifyId);
  assert.notEqual(first.body.installId, ping.installId());
});

test('at most one needs_you buzz per agent within the cooldown', async () => {
  enrol();
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  await withLeo(async (h) => {
    assert.equal(phonenotify.NEEDS_YOU_COOLDOWN_MS, 5 * 60 * 1000);
    await report(h, 'needs_you');
    await report(h, 'working');
    fakeNow += 4 * 60 * 1000;       // fixed times, not derived from the constant under test
    await report(h, 'needs_you');   // a new wait, but inside the cooldown
    assert.equal(sent.length, 1, 'a second needs_you inside the cooldown buzzed');
    await report(h, 'working');
    fakeNow += 2 * 60 * 1000;
    await report(h, 'needs_you');   // past it
    assert.equal(sent.length, 2, 'a needs_you after the cooldown did not send');
    await reply(h);                 // replies are not rate-limited
    assert.equal(sent.length, 3);
  });
});

test('needs_you names the project it stands under, carried forward when the report names none', async () => {
  enrol();
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  const p = projects.create({ name: 'Henderson lease' });
  await withLeo(async (h) => {
    await call('POST', '/api/report', { headers: h, body: { state: 'working', project: p.id, text: 'x' } });
    await report(h, 'needs_you');   // no project on this report
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.project, 'Henderson lease');
});

test('turning on always mints a fresh token, one turn-on at a time', async () => {
  enrol();
  await Promise.all([
    call('PUT', '/api/phone-notify', { body: { on: true } }),
    call('PUT', '/api/phone-notify', { body: { on: true } }),
  ]);
  const mints = () => (fs.readFileSync(TUNNEL_LOG, 'utf8').match(/ARGV: mac-request/g) || []).length;
  assert.equal(mints(), 1, 'two concurrent turn-ons each minted');
  await call('PUT', '/api/phone-notify', { body: { on: false } });
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  assert.equal(mints(), 2, 'turning on again reused the old token instead of minting');
});

test('a tunnel too old for mac-request says this computer needs an update, not that Kosmos+ is down', async () => {
  enrol();
  const old = path.join(SANDBOX, 'old-tunnel');
  fs.writeFileSync(old, "#!/bin/bash\necho \"error: unrecognized subcommand 'mac-request'\" >&2\nexit 2\n", { mode: 0o755 });
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = old;
  try {
    const r = await call('PUT', '/api/phone-notify', { body: { on: true } });
    assert.equal(r.code, 400);
    assert.match(r.json.error, /needs an update/);
    assert.equal(phonenotify.readState().on, false);
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL; }
});

test('names are capped in UTF-8 bytes, never inside a character', () => {
  const b = phonenotify.payload('n', { kind: 'needs_you', agent: '\u00e9'.repeat(60), session: 's', project: '\u{1F600}'.repeat(40) });
  assert.equal(Buffer.byteLength(b.agent), 80);
  assert.equal(Buffer.byteLength(b.project), 120);
  assert.equal(b.project, '\u{1F600}'.repeat(30));
});

test('turning off stops sending at once', async () => {
  enrol();
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  const off = await call('PUT', '/api/phone-notify', { body: { on: false } });
  assert.equal(off.json.on, false);
  await withLeo(async (h) => { await report(h, 'needs_you'); await reply(h); });
  assert.equal(sent.length, 0, 'something was sent after turning off');
});

test('a Mac not connected to Kosmos+ cannot turn it on, and nothing is saved', async () => {
  const on = await call('PUT', '/api/phone-notify', { body: { on: true } });
  assert.equal(on.code, 400);
  assert.match(on.json.error, /connect this computer to Kosmos\+ first/);
  assert.equal(phonenotify.readState().on, false);
  assert.equal(fs.existsSync(TUNNEL_LOG), false);
});

test('PUT refuses anything but a boolean', async () => {
  enrol();
  for (const on of ['yes', 1, null]) {
    const r = await call('PUT', '/api/phone-notify', { body: { on } });
    assert.equal(r.code, 400, 'accepted ' + JSON.stringify(on));
  }
});
