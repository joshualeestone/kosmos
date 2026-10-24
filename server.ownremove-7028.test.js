'use strict';
/**
 * kosmos#7028: the two routes over fedseats.ownAllowed / ownRemove. Behind the federation switch and screen only; what a
 * remove does to the room is engine/fedseats.ownremove-7028.test.js.
 */
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownremove-7028-'));
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
const REMOVE = { project: 'p-none', pub: 'pub-x' };

test('#7028: with the federation switch off, both routes answer 404 and sign nothing', async () => {
  live(false);
  const before = signed.length;
  assert.equal((await call('GET', '/api/federation/own-allowed?project=p1', undefined, SCREEN)).status, 404);
  assert.equal((await call('POST', '/api/federation/own-remove', REMOVE, SCREEN)).status, 404);
  assert.equal(signed.length, before);
});

test('#7028: own-allowed is screen only, needs a project, and lists nobody for a room this board does not seal', async () => {
  live(true);
  try {
    assert.equal((await call('GET', '/api/federation/own-allowed?project=p1')).status, 403, 'not from the screen');
    assert.equal((await call('GET', '/api/federation/own-allowed', undefined, SCREEN)).status, 400, 'no project');
    const ok = await call('GET', '/api/federation/own-allowed?project=p1', undefined, SCREEN);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { computers: [] });
  } finally { live(false); }
});

test('#7028: own-remove refuses a malformed body, a request not from the screen, and a room this board does not seal', async () => {
  live(true);
  try {
    for (const bad of ['not json', [], {}, { ...REMOVE, project: '' }, { ...REMOVE, pub: 7 }, { ...REMOVE, pub: '' }]) {
      assert.equal((await call('POST', '/api/federation/own-remove', bad, SCREEN)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await call('POST', '/api/federation/own-remove', REMOVE)).status, 403, 'not from the screen');
    const r = await call('POST', '/api/federation/own-remove', REMOVE, SCREEN);
    assert.equal(r.status, 409);
    assert.match(r.json.error, /^That computer was not taken out: only the computer that first shared this room can take another computer out of it\.$/);
  } finally { live(false); }
});

test('#7028: own-remove hands the engine exactly the project and key pressed, and own-allowed shows only pub, mac and time', async (t) => {
  const fedseats = require('./engine/fedseats');
  const calls = [];
  t.mock.method(fedseats, 'ownRemove', async (...a) => { calls.push(a); return { ok: true, because: null }; });
  t.mock.method(fedseats, 'ownAllowed', () => [{ pub: 'pub-w', mac: 'mac-w', at: 5, extra: 'not shown' }]);
  live(true);
  try {
    assert.deepEqual((await call('POST', '/api/federation/own-remove', { project: 'p1', pub: 'pub-w' }, SCREEN)).json, { removed: true });
    assert.deepEqual(calls, [['p1', 'pub-w']]);
    assert.deepEqual((await call('GET', '/api/federation/own-allowed?project=p1', undefined, SCREEN)).json, { computers: [{ pub: 'pub-w', mac: 'mac-w', at: 5 }] });
  } finally { live(false); }
});
