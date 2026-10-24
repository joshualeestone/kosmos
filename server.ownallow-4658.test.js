'use strict';
/**
 * kosmos#4658: the two routes over fedseats.ownWaiting / allowOwn. Behind the federation switch, screen only, and the
 * Allow under the family policy; what an Allow does to the room is engine/fedseats.ownseal-4658.test.js.
 */
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownallow-4658-'));
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
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const remote = require('./engine/remote');

const signed = [];
remote.macRequest = async (method, route, body) => { signed.push({ method, route, body }); return { ok: false, because: 'unexpected route ' + route }; };
remote.refreshFederationLiveIfStale = () => Promise.resolve();
remote.federationLive = () => false;   // the switch comes from the env below only

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const SCREEN = { 'sec-fetch-site': 'same-origin' };
async function call(method, route, body, headers = {}) {
  const res = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const live = (on) => { if (on) process.env.AGENT_WORKFORCE_FEDERATION_LIVE = '1'; else delete process.env.AGENT_WORKFORCE_FEDERATION_LIVE; };
const ALLOW = { project: 'p-none', pub: 'pub-x', code: 'ABCDE-FGHJK' };

test('#4658: with the federation switch off, both routes answer 404 and sign nothing', async () => {
  live(false);
  const before = signed.length;
  assert.equal((await call('GET', '/api/federation/own-waiting?project=p1', undefined, SCREEN)).status, 404);
  assert.equal((await call('POST', '/api/federation/own-allow', ALLOW, SCREEN)).status, 404);
  assert.equal(signed.length, before);
});

test('#4658: own-waiting is screen only, needs a project, and lists nobody for a room this board does not seal', async () => {
  live(true);
  try {
    assert.equal((await call('GET', '/api/federation/own-waiting?project=p1')).status, 403, 'not from the screen');
    assert.equal((await call('GET', '/api/federation/own-waiting', undefined, SCREEN)).status, 400, 'no project');
    const ok = await call('GET', '/api/federation/own-waiting?project=p1', undefined, SCREEN);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { computers: [] });
  } finally { live(false); }
});

test('#4658: own-allow refuses a malformed body, a request not from the screen, and a computer that is not waiting', async () => {
  live(true);
  try {
    for (const bad of ['not json', [], {}, { ...ALLOW, project: '' }, { ...ALLOW, pub: 7 }, { ...ALLOW, code: '  ' }]) {
      assert.equal((await call('POST', '/api/federation/own-allow', bad, SCREEN)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await call('POST', '/api/federation/own-allow', ALLOW)).status, 403, 'not from the screen');
    const r = await call('POST', '/api/federation/own-allow', ALLOW, SCREEN);
    assert.equal(r.status, 409);
    assert.match(r.json.error, /^That computer was not allowed: that computer is no longer waiting for this room's key\.$/);
  } finally { live(false); }
});
