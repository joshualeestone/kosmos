'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #6719: the star routes against the real server. Sandboxed as server.undo-5153.test.js is.
 *   node --test server.stars-6719.test.js */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-stars-route-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude-projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const get = async () => { const r = await fetch(base + '/api/agent-stars'); return { status: r.status, body: await r.json().catch(() => null) }; };
const put = async (body, headers = {}) => {
  const res = await fetch(base + '/api/agent-stars', { method: 'PUT', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('#6719: none at first; a star and an unstar are kept on the board; GET reads them back', async () => {
  assert.deepEqual(await get(), { status: 200, body: { names: [], ok: true } });
  assert.deepEqual(await put({ name: 'renet', on: true }), { status: 200, body: { names: ['renet'], ok: true } });
  assert.deepEqual(await put({ name: 'angel', on: true }), { status: 200, body: { names: ['renet', 'angel'], ok: true } });
  assert.deepEqual((await get()).body, { names: ['renet', 'angel'], ok: true });
  assert.deepEqual(await put({ name: 'renet', on: false }), { status: 200, body: { names: ['angel'], ok: true } });
  assert.deepEqual((await get()).body, { names: ['angel'], ok: true });
});

test('#6719: an agent cannot star; a bad request is a 400 and changes nothing', async () => {
  const before = (await get()).body;
  assert.equal((await put({ name: 'renet', on: true }, { 'x-kosmos-agent-token': 'any' })).status, 403, 'an agent token starred');
  assert.equal((await put({ name: 'renet', on: true, token: 'any' })).status, 403, 'an agent token in the body starred');
  for (const bad of [{ name: 'a/b', on: true }, { name: 'renet', on: 'yes' }, {}, [], 'not json', 'null']) {
    const r = await put(bad);
    assert.equal(r.status, 400, `accepted ${JSON.stringify(bad)}: ${JSON.stringify(r.body)}`);
  }
  assert.deepEqual((await get()).body, before, 'a refused request changed the stars');
});

test('#6719: a stars file that cannot be read answers ok false, a star is refused as a 500, and the file is kept', async () => {
  const file = require('./engine/stars').file();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{broken');
  try {
    assert.deepEqual(await get(), { status: 200, body: { names: [], ok: false } });
    assert.equal((await put({ name: 'renet', on: true })).status, 500);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken', 'the unreadable file was overwritten');
  } finally { fs.rmSync(file, { force: true }); }
});
