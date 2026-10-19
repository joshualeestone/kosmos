'use strict';
/* kosmos#6595 (R01, the step-up half): from a remote session, a key or token, an update and a new agent need a
   fresh second-factor sign-in, read from the two headers the Kosmos+ gate writes (x-kosmos-session-iat and
   x-kosmos-session-second; kosmos-relay sessioniat-6595, not checked from this repo). Refusals are checked against
   the real server: the gate runs before any route reads its body, so a refused request reaches nothing. Requests
   that PASS the gate are sent only to key routes with an unreadable body (they answer 400 and change nothing);
   update and agent creation are never let through here, and their pass arm is tested on the function. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remotestepup-6595-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TUNNEL_BIN = '/usr/bin/false';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, remoteSessionFresh, needsRemoteStepUp, remoteStepUpRefusal, REMOTE_STEP_UP, REMOTE_STEP_UP_SECS } = require('./server');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const now = () => Math.floor(Date.now() / 1000);
const PAGE = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
const VIA_PLUS = { ...PAGE, 'x-forwarded-host': 'hers.kosmos.invalid', 'x-forwarded-for': '203.0.113.9' };
const fresh = () => ({ 'x-kosmos-session-iat': String(now() - 30), 'x-kosmos-session-second': '1' });
const post = async (route, headers, raw) => {
  const res = await fetch(base + route, { method: 'POST', headers, body: raw === undefined ? '{}' : raw });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const STEP_UP_ROUTES = [
  '/api/update', '/api/update/rollback', '/api/connect/start',
  '/api/accounts/openai', '/api/accounts/claude/apikey', '/api/accounts/gemini/apikey', '/api/accounts/grok/apikey',
  '/api/accounts/qwen', '/api/cloudflare/token', '/api/svc/brave-search/token',
  '/api/agents', '/api/team', '/api/connect-agent',
];

for (const route of STEP_UP_ROUTES) {
  test(`R01: ${route} from a remote session with no fresh sign-in is refused with remote_step_up`, async () => {
    for (const [why, extra] of [
      ['no session headers', {}],
      ['a fresh time but no second factor', { 'x-kosmos-session-iat': String(now() - 30), 'x-kosmos-session-second': '0' }],
      ['the second factor but a stale time', { 'x-kosmos-session-iat': String(now() - REMOTE_STEP_UP_SECS - 5), 'x-kosmos-session-second': '1' }],
      ['a malformed time', { 'x-kosmos-session-iat': '1e9', 'x-kosmos-session-second': '1' }],
    ]) {
      const got = await post(route, { ...VIA_PLUS, ...extra });
      assert.equal(got.status, 403, `${route}, ${why}: ${JSON.stringify(got.body)}`);
      assert.deepEqual(got.body, { ...REMOTE_STEP_UP }, `${route}, ${why}`);
    }
  });
}

test('R01 CONTROL: a fresh remote sign-in, and a local request, pass the gate (a key route then reads its body)', async () => {
  for (const route of ['/api/accounts/gemini/apikey', '/api/accounts/grok/apikey', '/api/svc/brave-search/token']) {
    const remoteFresh = await post(route, { ...VIA_PLUS, ...fresh() }, 'not json');
    assert.notEqual(remoteFresh.body && remoteFresh.body.code, 'remote_step_up', route + ' refused a fresh remote session');
    assert.equal(remoteFresh.status, 400, route + ' fresh remote: ' + JSON.stringify(remoteFresh.body));
    const local = await post(route, PAGE, 'not json');
    assert.notEqual(local.body && local.body.code, 'remote_step_up', route + ' refused a local request');
    assert.equal(local.status, 400, route + ' local: ' + JSON.stringify(local.body));
  }
});

test('R01: taking things away is not gated (forget a token, sign a provider out)', () => {
  assert.equal(needsRemoteStepUp('/api/svc/brave-search/forget', 'POST'), false);
  assert.equal(needsRemoteStepUp('/api/accounts/gemini', 'DELETE'), false);
  assert.equal(needsRemoteStepUp('/api/accounts/qwen', 'DELETE'), false);
  assert.equal(needsRemoteStepUp('/api/accounts', 'GET'), false);
  assert.equal(needsRemoteStepUp('/api/update/check', 'POST'), false, 'checking for an update changes nothing');
  for (const route of STEP_UP_ROUTES) assert.equal(needsRemoteStepUp(route, 'POST'), true, route);
  assert.equal(needsRemoteStepUp('/api/svc/brave-search/token', 'GET'), false, 'only POST enters a token');
});

test('R01: freshness needs the second factor and a time within the window, bounded both sides', () => {
  const t = 1_800_000_000;
  const h = (iat, second) => ({ 'x-kosmos-session-iat': iat, 'x-kosmos-session-second': second });
  assert.equal(remoteSessionFresh(h(String(t - 30), '1'), t), true);
  assert.equal(remoteSessionFresh(h(String(t - REMOTE_STEP_UP_SECS), '1'), t), true, 'the edge of the window');
  assert.equal(remoteSessionFresh(h(String(t - REMOTE_STEP_UP_SECS - 1), '1'), t), false, 'one second past it');
  assert.equal(remoteSessionFresh(h(String(t + 60), '1'), t), true, 'a minute of clock drift');
  assert.equal(remoteSessionFresh(h(String(t + 61), '1'), t), false, 'further ahead is not fresh');
  assert.equal(remoteSessionFresh(h(String(t - 30), '0'), t), false, 'no second factor');
  assert.equal(remoteSessionFresh(h(String(t - 30), 'true'), t), false, 'only "1" counts');
  assert.equal(remoteSessionFresh({ 'x-kosmos-session-second': '1' }, t), false, 'no time');
  assert.equal(remoteSessionFresh({ 'x-kosmos-session-iat': String(t - 30) }, t), false, 'no second header');
  for (const bad of ['', ' 1', '-5', '1.5', '0x10', String(t - 30) + ', ' + String(t - 30)]) {
    assert.equal(remoteSessionFresh(h(bad, '1'), t), false, 'malformed time ' + JSON.stringify(bad));
  }
  assert.equal(remoteSessionFresh(undefined, t), false);
});

test('R01: the gate passes update and agent creation for a fresh remote session and for a local one (function only)', () => {
  const t = now();
  const req = (headers) => ({ method: 'POST', headers });
  for (const route of ['/api/update', '/api/agents', '/api/team', '/api/connect-agent', '/api/connect/start']) {
    assert.equal(remoteStepUpRefusal(req({ ...VIA_PLUS, ...fresh() }), route, t), null, route + ' fresh remote');
    assert.equal(remoteStepUpRefusal(req(PAGE), route, t), null, route + ' local');
    assert.equal(remoteStepUpRefusal(req(VIA_PLUS), route, t), REMOTE_STEP_UP, route + ' stale remote');
  }
  assert.equal(remoteStepUpRefusal(req(VIA_PLUS), '/api/agents/x/messages', t), null, 'an ungated route is never asked');
});
