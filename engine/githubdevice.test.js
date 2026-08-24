'use strict';

// Both sandbox knobs BEFORE any require, travelling together per #527.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-ghdev-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
// gh absent, whatever the machine has: the road under test is the no-gh one.
process.env.AGENT_WORKFORCE_GH_BIN = path.join(SANDBOX, 'no-such-gh');

const test = require('node:test');
const assert = require('node:assert/strict');
const gd = require('./githubdevice');

/**
 * The stub GitHub (#620's whole point: the flow runs END TO END with no
 * real client_id and no real GitHub). One HTTP server stands for the three
 * endpoints; a scriptable answers-queue drives the poll arms.
 */
let answers = [];
let deviceRequests = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/device/code') {
      deviceRequests.push(JSON.parse(body || '{}'));
      send(200, { device_code: 'dev-123', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 0 });
      return;
    }
    if (req.url === '/token') {
      const next = answers.length ? answers.shift() : { error: 'authorization_pending' };
      send(200, next);
      return;
    }
    if (req.url === '/user') {
      const auth = req.headers.authorization || '';
      if (auth === 'Bearer tok-live') { send(200, { login: 'joshualeestone' }); return; }
      send(401, { message: 'Bad credentials' });
      return;
    }
    send(404, {});
  });
});

test.before(async () => {
  await new Promise((ok) => stub.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + stub.address().port;
  process.env.AGENT_WORKFORCE_GITHUB_DEVICE_URL = base + '/device/code';
  process.env.AGENT_WORKFORCE_GITHUB_TOKEN_URL = base + '/token';
  process.env.AGENT_WORKFORCE_GITHUB_VERIFY_URL = base + '/user';
});
test.after(() => stub.close());

const settle = (ms) => new Promise((ok) => setTimeout(ok, ms));

test('the Josh-line: unconfigured, start refuses with the ruled sentence and state says why, nothing throws', async () => {
  delete process.env.KOSMOS_GITHUB_CLIENT_ID;
  const st = await gd.state();
  assert.equal(st.ready, false);
  assert.equal(st.because, gd.NO_APP);
  assert.equal(st.holder, 'kosmos');
  assert.equal(st.gh, 'missing');
  const started = await gd.start();
  assert.equal(started.refused, gd.NO_APP);
  assert.equal(started.connected, false);
});

test('the whole flow against the stub: code shown, pending then slow_down then token, stored 600, connected read from GitHub', async () => {
  process.env.KOSMOS_GITHUB_CLIENT_ID = 'Iv1.testclient';
  answers = [
    { error: 'authorization_pending' },
    { access_token: 'tok-live', token_type: 'bearer', scope: 'repo' },
  ];
  const started = await gd.start();
  assert.equal(started.phase, 'awaiting');
  assert.equal(started.code, 'ABCD-1234', 'the code lost its dash, and the door draws it verbatim');
  assert.equal(started.url, 'https://github.com/login/device');
  assert.equal(deviceRequests[0].client_id, 'Iv1.testclient');
  assert.equal(deviceRequests[0].scope, 'repo read:org');
  await settle(400);
  const st = await gd.state();
  assert.equal(st.connected, true, JSON.stringify(st));
  assert.equal(st.login, 'joshualeestone');
  assert.equal(st.held, true);
  assert.equal((fs.statSync(gd.FILE).mode & 0o777), 0o600, 'the held token is not mode 600');
  const kept = fs.readFileSync(gd.FILE, 'utf8').trim();
  assert.equal(kept, 'tok-live');
  assert.ok(!JSON.stringify(st).includes('tok-live'), 'state answered the token');
});

test('a revoked token shows as revoked: held, not connected, with a sentence', async () => {
  fs.writeFileSync(gd.FILE, 'tok-revoked\n', { mode: 0o600 });
  const st = await gd.state();
  assert.equal(st.held, true);
  assert.equal(st.connected, false);
  assert.match(st.because, /no longer accepts|did not confirm/);
});

test('forget deletes the held token and answers the fresh state', async () => {
  const st = await gd.forget();
  assert.equal(st.held, false);
  assert.equal(fs.existsSync(gd.FILE), false);
});

test('the declined arm fails with GitHub’s answer in a person’s sentence', async () => {
  answers = [{ error: 'access_denied' }];
  await gd.start();
  await settle(300);
  const st = await gd.state();
  assert.equal(st.phase, 'failed');
  assert.match(st.because, /declined/);
});

test('the expired arm names the remedy: start again for a fresh code', async () => {
  answers = [{ error: 'expired_token' }];
  await gd.start();
  await settle(300);
  const st = await gd.state();
  assert.equal(st.phase, 'failed');
  assert.match(st.because, /start again/);
});

test('slow_down honours GitHub’s rule: five real seconds pass before the next ask', async () => {
  /* The one deliberately slow test in this suite (~6s): the +5s reschedule
     is GitHub's own protocol rule, and only the clock can prove the maths.
     Not connected at one second; connected once the mandated wait passed. */
  answers = [{ error: 'slow_down' }, { access_token: 'tok-live', token_type: 'bearer', scope: 'repo' }];
  await gd.start();
  await settle(1000);
  assert.equal((await gd.state()).connected, false, 'the poll ignored slow_down and asked again early');
  await settle(5000);
  const st = await gd.state();
  assert.equal(st.connected, true, 'the slow_down reschedule never asked again at all');
  await gd.forget();
});

test('cancel stops a flow in flight and keeps any held token', async () => {
  answers = [{ error: 'authorization_pending' }];
  fs.mkdirSync(gd.DIR, { recursive: true });
  fs.writeFileSync(gd.FILE, 'tok-live\n', { mode: 0o600 });
  await gd.start();
  const st = await gd.cancel();
  assert.equal(st.phase, 'idle');
  assert.equal(st.held, true, 'cancel forgot the token; that is forget’s job, not cancel’s');
  await gd.forget();
});

test('the pasted client id survives to a fresh read, and a spaced one is refused', async () => {
  delete process.env.KOSMOS_GITHUB_CLIENT_ID;
  assert.equal(gd.setClientId('bad id').ok, false);
  assert.equal(gd.setClientId('Iv1.fromjosh').ok, true);
  assert.equal(gd.clientId(), 'Iv1.fromjosh');
  const st = await gd.state();
  assert.equal(st.ready, true);
  fs.rmSync(gd.APP_FILE, { force: true });
});
